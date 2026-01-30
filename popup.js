// Popup script for Shopify Image Crawler Extension

let currentUrl = '';
let isCustomilyDetected = false;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Popup] Initializing...');

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentUrl = tab.url;
  console.log('[Popup] Current URL:', currentUrl);

  // Update URL input
  document.getElementById('productUrl').value = currentUrl;

  // Check storage first
  chrome.storage.local.get(
    ['config_url', 'page_url', 'customily_detected', 'provider'],
    (stored) => {
      console.log('[Popup] Storage data:', stored);
      // NOTE: We could potentially use stored data here immediately,
      // but the existing logic seems to prefer checking via message first.
      // However, if we want to show it immediately if stored for *this* url, we could.
      // But let's stick to the message pattern to be sure it's fresh,
      // or we can use the storage if message fails?
      // The current code just logs it. I will leave it as logging for now,
      // but ensure provider is logged.
    },
  );

  // Check if Customily is detected on the page
  chrome.tabs.sendMessage(tab.id, { action: 'checkCustomily' }, (response) => {
    if (chrome.runtime.lastError) {
      console.log(
        '[Popup] Error sending message to content script:',
        chrome.runtime.lastError,
      );
      updatePageStatus(false);
      return;
    }

    console.log('[Popup] Response from content script:', response);

    if (response && response.detected) {
      updatePageStatus(true, response.configUrl, response.provider);
      isCustomilyDetected = true;
    } else {
      updatePageStatus(false);
    }
  });

  // Setup event listeners
  document.getElementById('crawlBtn').addEventListener('click', startCrawling);
});

function updatePageStatus(detected, configUrl = null, provider = 'customily') {
  const statusText = document.getElementById('pageStatusText');
  const crawlBtn = document.getElementById('crawlBtn');

  if (detected) {
    if (provider === 'buildyou') {
      statusText.textContent = '✅ BuildYou Detected';
    } else {
      // Both 'customily' and old 'medzt.com' configs show as Customily
      statusText.textContent = '✅ Customily Detected';
    }
    statusText.classList.add('detected');
    statusText.classList.remove('not-detected');
    crawlBtn.disabled = false;
  } else {
    statusText.textContent = '❌ Customily Not Found';
    statusText.classList.add('not-detected');
    statusText.classList.remove('detected');
    crawlBtn.disabled = true;
  }
}

async function startCrawling() {
  console.log('[Popup] Start crawling clicked');

  // Debug: Check storage before starting
  const stored = await chrome.storage.local.get([
    'config_url',
    'page_url',
    'customily_detected',
  ]);
  console.log('[Popup] Storage before crawl:', stored);
  console.log('[Popup] Current URL:', currentUrl);

  // Alert for debugging (you can remove this later)
  if (!stored.config_url) {
    alert(
      '⚠️ DEBUG: No config URL in storage!\\n\\nStored data: ' +
        JSON.stringify(stored, null, 2),
    );
  }

  const crawlBtn = document.getElementById('crawlBtn');
  const progressSection = document.getElementById('progressSection');
  const resultsSection = document.getElementById('resultsSection');

  // Disable button
  crawlBtn.disabled = true;
  crawlBtn.querySelector('.btn-text').textContent = 'Crawling...';

  // Show progress
  progressSection.style.display = 'block';
  resultsSection.style.display = 'none';

  updateProgress('Starting crawl...', 0, 4);

  try {
    // Get options
    const skipThumbnails = document.getElementById('skipThumbnails').checked;
    const organizeByCategory =
      document.getElementById('organizeByCategory').checked;

    // Send message to background script
    chrome.runtime.sendMessage(
      {
        action: 'startCrawl',
        url: currentUrl,
        options: {
          skipThumbnails,
          organizeByCategory,
        },
      },
      (response) => {
        if (response && !response.success) {
          showError(response.error);
        }
      },
    );
  } catch (error) {
    showError(error.message);
  }
}

// Set up message listener immediately when popup loads
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'crawlProgress') {
    updateProgress(message.status, message.current, message.total);
  } else if (message.type === 'crawlComplete') {
    showResults(message.data);
  } else if (message.type === 'crawlError') {
    showError(message.error);
  }
});

function updateProgress(text, current, total) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  document.getElementById('progressText').textContent = text;
  document.getElementById('progressCount').textContent =
    `${current}/${total} (${percentage}%)`;

  document.getElementById('progressFill').style.width = `${percentage}%`;
}

function showResults(data) {
  const resultsSection = document.getElementById('resultsSection');
  const progressSection = document.getElementById('progressSection');
  const crawlBtn = document.getElementById('crawlBtn');

  // Hide progress, show results
  progressSection.style.display = 'none';
  resultsSection.style.display = 'block';

  // Update stats
  document.getElementById('totalCategories').textContent = data.totalCategories;
  document.getElementById('totalImages').textContent = data.totalImages;
  document.getElementById('downloadedImages').textContent = data.downloaded;

  // Show categories
  const categoriesList = document.getElementById('categoriesList');
  categoriesList.innerHTML = '';

  Object.entries(data.categories).forEach(([name, images]) => {
    const item = document.createElement('div');
    item.className = 'category-item';
    item.innerHTML = `
      <span class="category-name">${name}</span>
      <span class="category-count">${images.length}</span>
    `;
    categoriesList.appendChild(item);
  });

  // Re-enable button
  crawlBtn.disabled = false;
  crawlBtn.querySelector('.btn-text').textContent = 'Crawl Again';
}

function showError(error) {
  const crawlBtn = document.getElementById('crawlBtn');
  const progressSection = document.getElementById('progressSection');

  progressSection.classList.add('hidden');

  alert(`Error: ${error}`);

  crawlBtn.disabled = false;
  crawlBtn.querySelector('.btn-text').textContent = 'Start Crawling';
}
