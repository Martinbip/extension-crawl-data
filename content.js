// Content script - runs on web pages to detect Customily

// Store detected config URL from network requests
let detectedConfigUrl = null;
let detectedApiType = null; // 'old' or 'unified' or 'cdn'

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
        // Check for CDN Customily (cdn.customily.com) - often contains .json
        else if (
          entry.name.includes('cdn.customily.com') &&
          entry.name.includes('.json')
        ) {
          detectedConfigUrl = entry.name;
          detectedApiType = 'old'; // Usually CDN serves the same JSON structure as the old API
          console.log(
            '[Content] 🎯 Intercepted CDN API config URL:',
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
  }

  // Method 2: Check performance entries for already-loaded config (if not caught by line 10 observer)
  if (!configUrl) {
    try {
      const entries = performance.getEntriesByType('resource');

      // Try old API first (medzt)
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

      // Try CDN API (cdn.customily.com)
      if (!configUrl) {
        const cdnEntry = entries.find(
          (e) =>
            e.name.includes('cdn.customily.com') && e.name.includes('.json'),
        );
        if (cdnEntry) {
          configUrl = cdnEntry.name;
          apiType = 'old'; // Assuming CDN json has same structure as old API
          console.log(
            '[Content] ✅ Found CDN API config URL in performance entries:',
            configUrl,
          );
        }
      }

      // Try Unified API if others not found
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

  // Method 3: Search in page HTML for APIs
  if (!configUrl) {
    const pageSource = document.documentElement.innerHTML;

    // Search for cdn.customily.com patterns
    const cdnPatterns = [
      /https:\/\/cdn\.customily\.com\/[^"'\s<>]+\.json[^"'\s<>]*/g,
      /"(https:\/\/cdn\.customily\.com\/[^"]+\.json[^"]*)"/g,
    ];

    for (const pattern of cdnPatterns) {
      const matches = pageSource.match(pattern);
      if (matches && matches.length > 0) {
        configUrl = matches[0].replace(/['"]/g, '');
        apiType = 'old';
        console.log(
          '[Content] ✅ Found CDN API config URL with pattern:',
          pattern,
          '→',
          configUrl,
        );
        break;
      }
    }

    // Search for sh.medzt.com patterns
    if (!configUrl) {
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
  }

  // Method 4: Try to construct old API URL from page metadata (FALLBACK)
  // REMOVED: This was causing false positives for cdn.customily.com stores.
  // We should not guess the URL if we can't find it.

  // Method 5: Check script tags (as another layer of lookup)
  if (!configUrl) {
    console.log('[Content] Checking script tags...');
    const scripts = Array.from(document.querySelectorAll('script'));
    for (const script of scripts) {
      const scriptContent = script.textContent || script.innerHTML;

      // Check for Medzt
      let match = scriptContent.match(
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

      // Check for CDN Customily
      match = scriptContent.match(
        /https:\/\/cdn\.customily\.com\/[^\s"']+\.json/,
      );
      if (match) {
        configUrl = match[0];
        apiType = 'old';
        console.log(
          '[Content] ✅ Found CDN API config URL in script tag:',
          configUrl,
        );
        break;
      }
    }
  }

  // Final confirmation check for any Customily elements
  const hasCustomilyElements =
    document.querySelector('.ant-form-item') !== null ||
    document.querySelector('[class*="customily"]') !== null ||
    document.querySelector('[id*="customily"]') !== null ||
    document.documentElement.innerHTML.includes('customily') ||
    document.documentElement.innerHTML.includes('medzt.com');

  if (configUrl) {
    // Determine provider type
    let provider = 'customily'; // Default

    if (apiType === 'buildyou' || configUrl.includes('buildyou.io')) {
      provider = 'buildyou';
    } else if (
      configUrl.includes('medzt.com') ||
      configUrl.includes('customily.com') ||
      configUrl.includes('customily')
    ) {
      provider = 'customily';
    }

    console.log(
      `[Content] ✅ ${provider.toUpperCase()} detected with ${apiType?.toUpperCase()} API:`,
      configUrl,
    );
    return {
      detected: true,
      configUrl: configUrl,
      apiType: apiType || 'old',
      provider: provider,
    };
  } else if (hasCustomilyElements) {
    console.log('[Content] ⚠️ Found Customily elements but no config URL');
    return {
      detected: true,
      configUrl: null,
      apiType: null,
      provider: 'customily',
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
      // Poll for BuildYou
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (window.BuildYou && window.BuildYou.store) { 
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
      storeResult(result);
      clearInterval(pollInterval);
    }
  }, 1000);
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkCustomily') {
    const result = checkCustomilyPresence();
    sendResponse(result);
  }

  return true; // Keep message channel open
});

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
