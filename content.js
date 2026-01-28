// Content script - runs on web pages to detect Customily

// Store detected config URL from network requests
let detectedConfigUrl = null;

// Monitor network requests for config URL (runs immediately)
if (typeof PerformanceObserver !== 'undefined') {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (
          entry.name.includes('sh.medzt.com') &&
          entry.name.includes('.json')
        ) {
          detectedConfigUrl = entry.name;
          console.log(
            '[Content] 🎯 Intercepted config URL from network:',
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

  // Try from Shopify object
  if (window.Shopify && window.Shopify.shop) {
    return window.Shopify.shop;
  }

  // Try to extract from page source
  const pageSource = document.documentElement.innerHTML;
  const match = pageSource.match(/"shop":\s*"([^"]+\.myshopify\.com)"/);
  if (match) {
    return match[1];
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

  // Method 1: Check performance entries for already-loaded config
  if (!configUrl) {
    try {
      const entries = performance.getEntriesByType('resource');
      const medztEntry = entries.find(
        (e) => e.name.includes('sh.medzt.com') && e.name.includes('.json'),
      );
      if (medztEntry) {
        configUrl = medztEntry.name;
        console.log(
          '[Content] ✅ Found config URL in performance entries:',
          configUrl,
        );
      }
    } catch (e) {
      console.log('[Content] Error checking performance entries:', e);
    }
  }

  // Method 2: Search in page HTML with multiple patterns
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
        console.log(
          '[Content] ✅ Found config URL with pattern:',
          pattern,
          '→',
          configUrl,
        );
        break;
      }
    }
  }

  // Method 3: Try to construct URL from page metadata
  if (!configUrl) {
    console.log(
      '[Content] Attempting to construct config URL from page metadata...',
    );

    const shopDomain = getShopDomain();
    const productHandle = getProductHandle();

    if (shopDomain && productHandle) {
      // Construct URL: https://sh.medzt.com/{shop_domain}/{product_handle}.json
      configUrl = `https://sh.medzt.com/${shopDomain}/${productHandle}.json`;
      console.log('[Content] 🔨 Constructed config URL:', configUrl);
    }
  }

  // Method 4: Check script tags directly
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
        console.log('[Content] ✅ Found config URL in script tag:', configUrl);
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
    console.log('[Content] ✅ Customily detected with config URL:', configUrl);
    return {
      detected: true,
      configUrl: configUrl,
    };
  } else if (hasCustomilyElements) {
    console.log('[Content] ⚠️ Found Customily elements but no config URL');
    return {
      detected: true,
      configUrl: null,
    };
  }

  console.log('[Content] ❌ Customily not detected');
  return {
    detected: false,
    configUrl: null,
  };
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkCustomily') {
    const result = checkCustomilyPresence();
    sendResponse(result);
  }

  return true; // Keep message channel open
});

// Auto-detect on page load
window.addEventListener('load', () => {
  console.log('[Content] Page loaded, auto-detecting Customily...');

  // Try immediately
  let result = checkCustomilyPresence();

  // If detected but no config URL, try again after delays (for dynamic loading)
  if (result.detected && !result.configUrl) {
    console.log('[Content] Retrying in 2 seconds for dynamic content...');
    setTimeout(() => {
      console.log('[Content] Retry attempt 1...');
      result = checkCustomilyPresence();

      // If still not found, try one more time after 5 seconds
      if (result.detected && !result.configUrl) {
        console.log('[Content] Retrying in 3 more seconds...');
        setTimeout(() => {
          console.log('[Content] Retry attempt 2...');
          result = checkCustomilyPresence();
          storeResult(result);
        }, 3000);
      } else {
        storeResult(result);
      }
    }, 2000);
  } else {
    storeResult(result);
  }
});

function storeResult(result) {
  if (result.detected) {
    console.log('[Content] Storing detection result in chrome.storage.local');
    chrome.storage.local.set(
      {
        customily_detected: true,
        config_url: result.configUrl,
        page_url: window.location.href,
      },
      () => {
        console.log('[Content] ✅ Stored:', {
          customily_detected: true,
          config_url: result.configUrl,
          page_url: window.location.href,
        });
      },
    );
  } else {
    console.log('[Content] Not storing - Customily not detected');
  }
}
