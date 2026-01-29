// Content script - runs on web pages to detect Customily

// Store detected config URL from network requests
let detectedConfigUrl = null;
let detectedApiType = null; // 'old' or 'unified'

// Monitor network requests for config URL (runs immediately)
if (typeof PerformanceObserver !== 'undefined') {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Check for old API (sh.medzt.com)
        if (
          entry.name.includes('sh.medzt.com') &&
          entry.name.includes('.json')
        ) {
          detectedConfigUrl = entry.name;
          detectedApiType = 'old';
          console.log(
            '[Content] 🎯 Intercepted OLD API config URL:',
            detectedConfigUrl,
          );
        }
        // Check for new Unified API (sh.customily.com/api/settings/unified)
        else if (entry.name.includes('sh.customily.com/api/settings/unified')) {
          detectedConfigUrl = entry.name;
          detectedApiType = 'unified';
          console.log(
            '[Content] 🎯 Intercepted UNIFIED API config URL:',
            detectedConfigUrl,
          );
        }
      }
    });
    observer.observe({ entryTypes: ['resource'] });
  } catch (e) {
    console.log('[Content] PerformanceObserver not available:', e);
  }
}

// Helper: Get shop domain from page
function getShopDomain() {
  // Try meta tag
  const metaShop = document.querySelector('meta[name="shopify-shop"]');
  if (metaShop) {
    return metaShop.content;
  }

  // Try from Shopify object (if available in content script - usually not, but check)
  // Note: content scripts can't see page variables directly, so this usually fails
  // unless we inject a script.

  // Try to extract from page source (most reliable for content script)
  const pageSource = document.documentElement.innerHTML;
  const match = pageSource.match(/Shopify\.shop\s*=\s*"([^"]+)"/);
  if (match) {
    return match[1];
  }

  const match2 = pageSource.match(/"shop":\s*"([^"]+\.myshopify\.com)"/);
  if (match2) {
    return match2[1];
  }

  return null;
}

// ... (other functions)

// Inject script to extract BuildYou data from Main World
function injectBuildYouExtractor() {
  const script = document.createElement('script');
  script.textContent = `
    (function() {
      // Poll for BuildYou
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (window.BuildYou && window.BuildYou.store) { // Wait for store to be present
           const data = {
             slug: window.BuildYou.product?.slug || window.BuildYou.slug,
             store: window.BuildYou.store
           };
           window.postMessage({ type: 'BUILDYOU_EXTRACTED', data: data }, '*');
           clearInterval(interval);
        }
        if (attempts > 20) clearInterval(interval); // Stop after 10 seconds
      }, 500);
    })();
  `;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

// Listen for messages from injected script
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'BUILDYOU_EXTRACTED') {
    console.log(
      '[Content] Received BuildYou data from main world:',
      event.data.data,
    );
    window.detectedBuildYouData = event.data.data;

    // Trigger check immediately
    const result = checkCustomilyPresence();
    storeResult(result);
  }
});

// Auto-detect on page load
window.addEventListener('load', () => {
  console.log('[Content] Page loaded, auto-detecting Customily...');

  // Inject extractor for BuildYou (Main World access)
  injectBuildYouExtractor();

  // Try immediately
  let result = checkCustomilyPresence();

  // Polling for dynamic content
  let retryCount = 0;
  const maxRetries = 10;

  const pollInterval = setInterval(() => {
    retryCount++;
    console.log(`[Content] Polling check ${retryCount}/${maxRetries}...`);
    result = checkCustomilyPresence();

    if (result.detected && result.configUrl) {
      storeResult(result);
      clearInterval(pollInterval);
    } else if (retryCount >= maxRetries) {
      storeResult(result); // Store final result even if false
      clearInterval(pollInterval);
    }
  }, 1000);
});

// Helper: Get product handle from URL
function getProductHandle() {
  const url = window.location.pathname;
  const match = url.match(/\/products\/([^?\/]+)/);
  return match ? match[1] : null;
}

// Check if Customily is present on the page
function checkCustomilyPresence() {
  console.log('[Content] Checking for Customily presence...');

  let configUrl = detectedConfigUrl; // Use intercepted URL if available
  let apiType = detectedApiType;

  // Method 1: Check for BuildYou FIRST (highest priority)
  if (!configUrl) {
    // Strategy A: Check if we received data from injected script (Main World)
    if (window.detectedBuildYouData) {
      const { slug, store } = window.detectedBuildYouData;
      console.log('[Content] BuildYou data from injection:', { slug, store });
      if (slug && store) {
        configUrl = `https://ext-api.buildyou.io/v1/campaigns/by-product-slug/${slug}?store_domain=${store}`;
        apiType = 'buildyou';
        console.log(
          '[Content] 🚀 Found BuildYou config via Injected Script:',
          configUrl,
        );
      }
    }

    // Strategy B: Check window.BuildYou (only works if not isolated, unlikely but good to keep)
    if (
      !configUrl &&
      window.BuildYou &&
      window.BuildYou.product &&
      window.BuildYou.store
    ) {
      const slug = window.BuildYou.product.slug || window.BuildYou.slug;
      const store = window.BuildYou.store;
      console.log('[Content] BuildYou data from window.BuildYou:', {
        slug,
        store,
      });

      if (slug && store) {
        configUrl = `https://ext-api.buildyou.io/v1/campaigns/by-product-slug/${slug}?store_domain=${store}`;
        apiType = 'buildyou';
        console.log(
          '[Content] 🚀 Found BuildYou config via Window object:',
          configUrl,
        );
      }
    }

    // Strategy C: Construct from metadata (fallback)
    if (!configUrl) {
      const shopDomain = getShopDomain();
      const productHandle = getProductHandle();
      console.log('[Content] Fallback metadata:', {
        shopDomain,
        productHandle,
      });

      // Check if page has BuildYou script or elements to justify this guess
      const hasBuildYouScript =
        document.body.innerHTML.includes('buildyou.io') ||
        document.head.innerHTML.includes('buildyou.io');

      if (shopDomain && productHandle && hasBuildYouScript) {
        configUrl = `https://ext-api.buildyou.io/v1/campaigns/by-product-slug/${productHandle}?store_domain=${shopDomain}`;
        apiType = 'buildyou';
        console.log(
          '[Content] 🔨 Constructed BuildYou config from metadata:',
          configUrl,
        );
      }
    }
  }

  // Method 2: Check performance entries for already-loaded config
  if (!configUrl) {
    try {
      const entries = performance.getEntriesByType('resource');

      // Try old API first
      const medztEntry = entries.find(
        (e) => e.name.includes('sh.medzt.com') && e.name.includes('.json'),
      );
      if (medztEntry) {
        configUrl = medztEntry.name;
        apiType = 'old';
        console.log(
          '[Content] ✅ Found OLD API config URL in performance entries:',
          configUrl,
        );
      }

      // Try Unified API if old API not found
      if (!configUrl) {
        const unifiedEntry = entries.find((e) =>
          e.name.includes('sh.customily.com/api/settings/unified'),
        );
        if (unifiedEntry) {
          configUrl = unifiedEntry.name;
          apiType = 'unified';
          console.log(
            '[Content] ✅ Found UNIFIED API config URL in performance entries:',
            configUrl,
          );
        }
      }
    } catch (e) {
      console.log('[Content] Error checking performance entries:', e);
    }
  }

  // Method 3: Search in page HTML for old API
  if (!configUrl) {
    const pageSource = document.documentElement.innerHTML;

    const patterns = [
      /https:\/\/sh\.medzt\.com\/[^"'\s<>]+\.json[^"'\s<>]*/g,
      /https:\/\/sh\.medzt\.com\/[^"'\s]+\.json/g,
      /"(https:\/\/sh\.medzt\.com\/[^"]+\.json[^"]*)"/g,
      /'(https:\/\/sh\.medzt\.com\/[^']+\.json[^']*)'/g,
    ];

    for (const pattern of patterns) {
      const matches = pageSource.match(pattern);
      if (matches && matches.length > 0) {
        configUrl = matches[0].replace(/['"]/g, '');
        apiType = 'old';
        console.log(
          '[Content] ✅ Found OLD API config URL with pattern:',
          pattern,
          '→',
          configUrl,
        );
        break;
      }
    }
  }

  // Method 4: Try to construct old API URL from page metadata
  if (!configUrl) {
    console.log(
      '[Content] Attempting to construct config URL from page metadata...',
    );

    const shopDomain = getShopDomain();
    const productHandle = getProductHandle();

    if (shopDomain && productHandle) {
      // Construct old API URL: https://sh.medzt.com/{shop_domain}/{product_handle}.json
      configUrl = `https://sh.medzt.com/${shopDomain}/${productHandle}.json`;
      apiType = 'old';
      console.log('[Content] 🔨 Constructed OLD API config URL:', configUrl);
    }
  }

  // Method 5: Check script tags for old API
  if (!configUrl) {
    console.log('[Content] Checking script tags...');
    const scripts = Array.from(document.querySelectorAll('script'));
    for (const script of scripts) {
      const scriptContent = script.textContent || script.innerHTML;
      const match = scriptContent.match(
        /https:\/\/sh\.medzt\.com\/[^\s"']+\.json/,
      );
      if (match) {
        configUrl = match[0];
        apiType = 'old';
        console.log(
          '[Content] ✅ Found OLD API config URL in script tag:',
          configUrl,
        );
        break;
      }
    }
  }

  // Check for Customily elements as fallback detection
  const hasCustomilyElements =
    document.querySelector('.ant-form-item') !== null ||
    document.querySelector('[class*="customily"]') !== null ||
    document.querySelector('[id*="customily"]') !== null ||
    document.documentElement.innerHTML.includes('customily') ||
    document.documentElement.innerHTML.includes('medzt.com');

  if (configUrl) {
    // Determine provider type
    // Check if it's Maconner (medzt.com)
    const isMaconner = configUrl.includes('medzt.com');
    // Check if it's BuildYou
    const isBuildYou = apiType === 'buildyou';

    let provider = 'customily';
    if (isMaconner) provider = 'maconner';
    if (isBuildYou) provider = 'buildyou';

    console.log(
      `[Content] ✅ ${provider.toUpperCase()} detected with ${apiType?.toUpperCase()} API:`,
      configUrl,
    );
    return {
      detected: true,
      configUrl: configUrl,
      apiType: apiType || 'old', // Default to 'old' if not set
      provider: provider,
    };
  } else if (hasCustomilyElements) {
    console.log('[Content] ⚠️ Found Customily elements but no config URL');
    return {
      detected: true,
      configUrl: null,
      apiType: null,
      provider: 'customily', // Valid assumption? or unknown? defaulting to customily for now
    };
  }

  console.log('[Content] ❌ Customily not detected');
  return {
    detected: false,
    configUrl: null,
    apiType: null,
    provider: null,
  };
}

// Inject script to extract BuildYou data from Main World
function injectBuildYouExtractor() {
  const script = document.createElement('script');
  script.textContent = `
    (function() {
      try {
        if (window.BuildYou) {
           const data = {
             slug: window.BuildYou.product?.slug || window.BuildYou.slug,
             store: window.BuildYou.store
           };
           window.postMessage({ type: 'BUILDYOU_EXTRACTED', data: data }, '*');
        }
      } catch(e) {}
    })();
  `;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

// Listen for messages from injected script
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'BUILDYOU_EXTRACTED') {
    console.log(
      '[Content] Received BuildYou data from main world:',
      event.data.data,
    );
    window.detectedBuildYouData = event.data.data;
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkCustomily') {
    const result = checkCustomilyPresence();
    sendResponse(result);
  }

  return true; // Keep message channel open
});

// (Replaced in previous step)

function storeResult(result) {
  if (result.detected) {
    console.log('[Content] Storing detection result in chrome.storage.local');
    chrome.storage.local.set(
      {
        customily_detected: true,
        config_url: result.configUrl,
        api_type: result.apiType,
        provider: result.provider,
        page_url: window.location.href,
      },
      () => {
        console.log('[Content] ✅ Stored:', {
          customily_detected: true,
          config_url: result.configUrl,
          api_type: result.apiType,
          provider: result.provider,
          page_url: window.location.href,
        });
      },
    );
  } else {
    console.log('[Content] Not storing - Customily not detected');
  }
}
