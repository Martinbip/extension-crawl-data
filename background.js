// Background service worker - handles crawling logic

// Import JSZip library
importScripts('jszip.min.js');

const BASE_ASSET_URL = 'https://assets.medzt.com/';

// Listen for crawl requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startCrawl') {
    handleCrawl(request.url, request.options)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true; // Keep message channel open for async response
  }
});

async function handleCrawl(productUrl, options) {
  try {
    // Step 1: Find config URL
    sendProgress('Finding Customily config...', 0, 4);
    const configData = await findConfigUrl(productUrl);

    if (!configData) {
      const errorMsg =
        'Could not find Customily configuration URL. Please make sure:\n' +
        '1. The page has fully loaded\n' +
        '2. The product uses Customily personalization\n' +
        '3. Try refreshing the page and opening the extension again';
      throw new Error(errorMsg);
    }

    const { url: configUrl, apiType } = configData;
    console.log(
      `[Background] Using ${apiType.toUpperCase()} API config URL:`,
      configUrl,
    );

    // Step 2: Fetch configuration
    sendProgress('Fetching configuration...', 1, 4);
    const config = await fetchConfig(configUrl);

    // Step 3: Parse images
    sendProgress('Parsing images...', 2, 4);
    const imagesByCategory = parseClipartCategories(
      config,
      apiType,
      options.skipThumbnails,
    );

    // Step 4: Download images as ZIP
    sendProgress('Creating ZIP file...', 3, 4);
    const downloadResults = await downloadImagesAsZip(
      imagesByCategory,
      productUrl,
    );

    // Complete
    sendProgress('Complete!', 4, 4);

    const result = {
      totalCategories: Object.keys(imagesByCategory).length,
      totalImages: Object.values(imagesByCategory).reduce(
        (sum, imgs) => sum + imgs.length,
        0,
      ),
      downloaded: downloadResults.downloaded,
      categories: imagesByCategory,
    };

    // Send completion message
    chrome.runtime.sendMessage({
      type: 'crawlComplete',
      data: result,
    });

    return result;
  } catch (error) {
    chrome.runtime.sendMessage({
      type: 'crawlError',
      error: error.message,
    });
    throw error;
  }
}

async function findConfigUrl(productUrl) {
  try {
    // First, try to get the config URL from storage (already detected by content script)
    const stored = await chrome.storage.local.get([
      'config_url',
      'api_type',
      'page_url',
    ]);

    console.log('[Background] Stored data:', stored);
    console.log('[Background] Current product URL:', productUrl);

    // If we have a stored config URL for this page, use it
    if (stored.config_url && stored.page_url === productUrl) {
      console.log(
        `[Background] Using stored ${stored.api_type?.toUpperCase() || 'OLD'} API config URL:`,
        stored.config_url,
      );
      return {
        url: stored.config_url,
        apiType: stored.api_type || 'old',
      };
    }

    // Fallback: Try to fetch HTML and find config URL (old API only)
    console.log('[Background] No stored config URL, fetching HTML...');
    const response = await fetch(productUrl);
    const html = await response.text();

    const pattern = /https:\/\/sh\.medzt\.com\/[^"'\s<>]+\.json[^"'\s<>]*/g;
    const matches = html.match(pattern);

    if (matches && matches[0]) {
      console.log('[Background] Found OLD API config URL in HTML:', matches[0]);
      return {
        url: matches[0],
        apiType: 'old',
      };
    }

    console.error('[Background] Could not find config URL in HTML');
    return null;
  } catch (error) {
    console.error('[Background] Error finding config URL:', error);
    return null;
  }
}

async function fetchConfig(configUrl) {
  const response = await fetch(configUrl);
  if (!response.ok) {
    throw new Error('Failed to fetch configuration');
  }
  return await response.json();
}

// Parse Unified API format to old API format
function parseUnifiedConfig(config) {
  console.log('[Background] Parsing Unified API format...');

  const options = config.sets?.[0]?.options || [];

  // Convert options to clipartCategories format
  const clipartCategories = options
    .filter((opt) => opt.values && opt.values.length > 0)
    .map((opt) => {
      const categoryName = opt.label || 'Unknown';

      // Convert values to cliparts format - FILTER OUT values without thumb_image
      const cliparts = opt.values
        .filter((val) => val.thumb_image && val.thumb_image.trim() !== '') // Only include values with valid image URLs
        .map((val) => {
          // Extract filename from thumb_image URL
          const imageUrl = val.thumb_image;
          const filename = imageUrl.split('/').pop() || 'unknown.png';

          return {
            title: val.tooltip || val.value || 'Unknown',
            label: val.tooltip || val.value || 'Unknown',
            file: imageUrl, // Store full URL directly
            filename: filename,
            url: imageUrl, // Add URL for direct access
          };
        });

      return {
        title: categoryName,
        label: categoryName,
        cliparts: cliparts,
        children: [], // Unified API doesn't have nested categories
      };
    })
    .filter((category) => category.cliparts.length > 0); // Remove categories with no valid images

  console.log(
    `[Background] Converted ${clipartCategories.length} Unified API options to categories`,
  );
  return clipartCategories;
}

function parseClipartCategories(config, apiType, skipThumbnails) {
  const imagesByCategory = {};

  // Get categories based on API type
  let clipartCategories;
  if (apiType === 'unified') {
    clipartCategories = parseUnifiedConfig(config);
  } else {
    clipartCategories = config.clipartCategories || [];
  }

  console.log(
    `[Background] Processing ${clipartCategories.length} categories (${apiType} API)`,
  );

  // Recursive function to process category and its children
  function processCategory(category, parentPath = '') {
    const categoryName = category.title || category.label || 'Unknown';
    const cliparts = category.cliparts || [];

    // Build folder path (parent/child)
    const categoryPath = parentPath
      ? `${parentPath}/${categoryName}`
      : categoryName;

    // Process cliparts in this category
    if (cliparts.length > 0) {
      if (!imagesByCategory[categoryPath]) {
        imagesByCategory[categoryPath] = [];
      }

      cliparts.forEach((clipart) => {
        // Get main image
        const fileData = clipart.file;
        let imageUrl = '';
        let filename = '';

        // Check if this is from Unified API (has full URL in clipart.url)
        if (clipart.url) {
          imageUrl = clipart.url;
          filename = clipart.filename || clipart.url.split('/').pop();
        }
        // Old API format
        else {
          let fileKey = '';
          if (typeof fileData === 'string') {
            fileKey = fileData;
          } else if (fileData && fileData.key) {
            fileKey = fileData.key;
          }

          if (fileKey) {
            imageUrl = BASE_ASSET_URL + fileKey;
            filename = fileKey.split('/').pop();
          }
        }

        if (imageUrl) {
          const label = clipart.title || clipart.label || '';
          imagesByCategory[categoryPath].push({
            url: imageUrl,
            label: label,
            filename: filename,
            type: 'main',
          });
        }

        // Get thumbnail if not skipping
        if (!skipThumbnails) {
          const thumbnailData = clipart.thumbnail;
          let thumbnailKey = '';

          if (typeof thumbnailData === 'string') {
            thumbnailKey = thumbnailData;
          } else if (thumbnailData && thumbnailData.key) {
            thumbnailKey = thumbnailData.key;
          }

          if (thumbnailKey && thumbnailKey !== fileKey) {
            const label = clipart.title || clipart.label || '';
            imagesByCategory[categoryPath].push({
              url: BASE_ASSET_URL + thumbnailKey,
              label: label + ' (thumbnail)',
              filename: thumbnailKey.split('/').pop(),
              type: 'thumbnail',
            });
          }
        }
      });
    }

    // Recursively process children
    const children = category.children || [];
    children.forEach((childCategory) => {
      processCategory(childCategory, categoryPath);
    });
  }

  // Process all top-level categories
  clipartCategories.forEach((category) => {
    processCategory(category);
  });

  return imagesByCategory;
}

async function downloadImagesAsZip(imagesByCategory, productUrl) {
  const totalImages = Object.values(imagesByCategory).reduce(
    (sum, imgs) => sum + imgs.length,
    0,
  );

  // Create unique folder name for this crawl session
  const productHandle = extractProductHandle(productUrl);
  const timestamp = new Date().toISOString().slice(0, 16).replace(/:/g, '-');
  const zipFilename = `${productHandle}_${timestamp}`;

  console.log('[Background] Creating ZIP file:', zipFilename);
  sendProgress(`Creating ZIP file...`, 3, 4);

  // Create new ZIP instance
  const zip = new JSZip();

  let downloaded = 0;
  let failed = 0;

  // Download all images and add to ZIP
  for (const [category, images] of Object.entries(imagesByCategory)) {
    const sanitizedCategory = sanitizeFilename(category);

    for (let i = 0; i < images.length; i++) {
      const image = images[i];

      try {
        // Update progress
        sendProgress(
          `Downloading ${category}... (${downloaded + 1}/${totalImages})`,
          3,
          4,
        );

        // Fetch image as blob
        const response = await fetch(image.url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();

        // Log detailed info for debugging
        console.log(`[Background] Fetched image:`, {
          url: image.url,
          status: response.status,
          contentType: response.headers.get('content-type'),
          blobSize: blob.size,
          blobType: blob.type,
        });

        // Create filename
        const sanitizedLabel = sanitizeFilename(image.label);
        const filename = `${String(i + 1).padStart(3, '0')}_${sanitizedLabel}_${image.filename}`;

        // Add to ZIP with folder structure: category/filename
        zip.folder(sanitizedCategory).file(filename, blob);

        downloaded++;
        console.log(
          `[Background] Added to ZIP (${downloaded}/${totalImages}):`,
          filename,
          `(${(blob.size / 1024).toFixed(2)} KB)`,
        );
      } catch (error) {
        console.error('[Background] Failed to download:', image.url, error);
        failed++;
      }
    }
  }

  // Generate ZIP file
  sendProgress(`Generating ZIP file... (${downloaded} images)`, 3, 4);
  console.log('[Background] Generating ZIP blob...');

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  console.log(
    '[Background] ZIP size:',
    (zipBlob.size / 1024 / 1024).toFixed(2),
    'MB',
  );

  // Download ZIP file
  sendProgress(`Preparing download...`, 3, 4);

  // Convert Blob to Data URL (URL.createObjectURL not available in Service Workers)
  const reader = new FileReader();
  const dataUrl = await new Promise((resolve, reject) => {
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(zipBlob);
  });

  console.log('[Background] Data URL created, starting download...');

  await chrome.downloads.download({
    url: dataUrl,
    filename: `shopify-personalization/${zipFilename}.zip`,
    saveAs: false,
  });

  console.log('[Background] ZIP download started:', zipFilename + '.zip');

  return { downloaded, failed };
}

// Helper: Extract product handle from URL
function extractProductHandle(url) {
  try {
    const urlObj = new URL(url);
    const match = urlObj.pathname.match(/\/products\/([^?\/]+)/);
    if (match) {
      return match[1].substring(0, 50); // Limit length
    }
  } catch (e) {
    console.error('Error extracting product handle:', e);
  }
  return 'product';
}

function sanitizeFilename(name) {
  const invalidChars = /[<>:"/\\|?*]/g;
  return name.replace(invalidChars, '_').trim();
}

function sendProgress(status, current, total) {
  chrome.runtime.sendMessage({
    type: 'crawlProgress',
    status: status,
    current: current,
    total: total,
  });
}
