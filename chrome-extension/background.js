// Background service worker for Lattice LinkedIn Helper

// Listen for messages from the web app
chrome.runtime.onMessageExternal.addListener(
  (request, sender, sendResponse) => {
    console.log('Lattice: Received external message:', request);

    if (request.action === 'ping') {
      // Health check - app uses this to detect if extension is installed
      sendResponse({ success: true, version: '1.0.0' });
      return true;
    }

    if (request.action === 'scrapeLinkedIn') {
      const { linkedinUrl } = request;

      // Open LinkedIn profile in a new tab and scrape it
      scrapeLinkedInProfile(linkedinUrl)
        .then(result => {
          console.log('Lattice: Scrape complete, sending response:', result);
          sendResponse(result);
        })
        .catch(error => {
          console.error('Lattice: Scrape error:', error);
          sendResponse({ success: false, error: error.message });
        });

      return true; // Keep message channel open for async response
    }

    sendResponse({ success: false, error: 'Unknown action' });
    return true;
  }
);

async function scrapeLinkedInProfile(linkedinUrl) {
  return new Promise((resolve, reject) => {
    // Open the LinkedIn profile in a new tab
    chrome.tabs.create({ url: linkedinUrl, active: true }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const tabId = tab.id;
      let hasResponded = false;
      let retryCount = 0;
      const maxRetries = 3;

      // Function to attempt scraping
      const attemptScrape = () => {
        if (hasResponded) return;

        chrome.tabs.sendMessage(tabId, { action: 'scrape' }, (response) => {
          if (hasResponded) return;

          if (chrome.runtime.lastError) {
            console.log('Lattice: Scrape attempt failed, retrying...', retryCount);
            retryCount++;
            if (retryCount < maxRetries) {
              // Retry after a short delay
              setTimeout(attemptScrape, 1000);
            } else {
              hasResponded = true;
              chrome.tabs.onUpdated.removeListener(listener);
              reject(new Error('Could not communicate with LinkedIn page. Make sure you are logged in.'));
            }
            return;
          }

          if (response && response.success) {
            hasResponded = true;
            chrome.tabs.onUpdated.removeListener(listener);
            resolve({ success: true, data: response.data });
          } else if (response && !response.success) {
            // Got a response but scraping failed - retry
            retryCount++;
            if (retryCount < maxRetries) {
              setTimeout(attemptScrape, 1000);
            } else {
              hasResponded = true;
              chrome.tabs.onUpdated.removeListener(listener);
              reject(new Error(response?.error || 'Failed to scrape profile'));
            }
          }
        });
      };

      // Listen for page load states
      const listener = (updatedTabId, changeInfo, updatedTab) => {
        if (updatedTabId !== tabId || hasResponded) return;

        // Try scraping on 'interactive' (DOM ready) or 'complete'
        if (changeInfo.status === 'complete') {
          console.log('Lattice: Page complete, attempting scrape...');
          // Small delay to let React/JS render
          setTimeout(attemptScrape, 800);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      // Also try scraping after a fixed delay as backup
      setTimeout(() => {
        if (!hasResponded) {
          console.log('Lattice: Backup scrape attempt...');
          attemptScrape();
        }
      }, 3000);

      // Final timeout
      setTimeout(() => {
        if (!hasResponded) {
          hasResponded = true;
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new Error('Timeout: LinkedIn page took too long. Try again or check your connection.'));
        }
      }, 20000);
    });
  });
}
