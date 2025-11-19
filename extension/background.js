// Background script for ChatGPT Enhancement Extension

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'create_chat_and_summarize') {
        handleCreateChatAndSummarize(request.content, sender.tab.id);
        return true; // Keep channel open for async response
    }
});

async function handleCreateChatAndSummarize(content, sourceTabId) {
    try {
        // 1. Create a new tab with ChatGPT
        const newTab = await chrome.tabs.create({
            url: 'https://chatgpt.com/?model=gpt-4o-mini', // Use a fast model
            active: false // Open in background
        });

        // 2. Wait for the tab to load
        chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
            if (tabId === newTab.id && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);

                // 3. Send the content to the new tab to summarize
                // We need to inject a content script or use the existing one to handle this
                // For now, we'll assume the content script is loaded and listening
                setTimeout(() => {
                    chrome.tabs.sendMessage(newTab.id, {
                        action: 'summarize_text',
                        text: content
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.error('Error sending to new tab:', chrome.runtime.lastError);
                            return;
                        }

                        if (response && response.summary) {
                            // 4. Send summary back to original tab
                            chrome.tabs.sendMessage(sourceTabId, {
                                action: 'update_title',
                                summary: response.summary
                            });

                            // 5. Close the temporary tab
                            chrome.tabs.remove(newTab.id);
                        }
                    });
                }, 3000); // Give it a bit more time to initialize
            }
        });

    } catch (error) {
        console.error('Error in auto-rename:', error);
    }
}
