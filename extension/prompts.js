// prompts.js - Logic for managing prompts

class PromptManager {
    constructor() {
        this.prompts = [];
        this.storageKey = 'chatgpt_prompts';
        this.listeners = new Set();
    }

    async init() {
        await this.loadPrompts();
    }

    async loadPrompts() {
        const result = await chrome.storage.local.get(this.storageKey);
        this.prompts = result[this.storageKey] || [];
        // Default prompts if empty
        if (this.prompts.length === 0) {
            this.prompts = [
                { id: '1', title: 'Summarize', content: 'Please summarize the text above in a concise bulleted list.' },
                { id: '2', title: 'Explain Like I\'m 5', content: 'Explain this concept to me as if I were a 5-year-old.' },
                { id: '3', title: 'Code Review', content: 'Review the following code for bugs, performance issues, and best practices.' }
            ];
            this.savePrompts();
        }
    }

    async savePrompts() {
        await chrome.storage.local.set({ [this.storageKey]: this.prompts });
        this.notifyListeners();
    }

    createPrompt(title, content) {
        const newPrompt = {
            id: crypto.randomUUID(),
            title: title,
            content: content
        };
        this.prompts.push(newPrompt);
        this.savePrompts();
        return newPrompt;
    }

    deletePrompt(id) {
        const index = this.prompts.findIndex(p => p.id === id);
        if (index !== -1) {
            this.prompts.splice(index, 1);
            this.savePrompts();
        }
    }

    exportPrompts() {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.prompts, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "chatgpt_prompts.json");
        document.body.appendChild(downloadAnchorNode); // required for firefox
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    }

    async importPrompts(jsonString) {
        try {
            const newPrompts = JSON.parse(jsonString);
            if (Array.isArray(newPrompts)) {
                // Merge or replace? Let's append for now
                this.prompts = [...this.prompts, ...newPrompts];
                await this.savePrompts();
                alert('Prompts imported successfully!');
            } else {
                alert('Invalid JSON format.');
            }
        } catch (e) {
            alert('Error parsing JSON: ' + e.message);
        }
    }

    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    notifyListeners() {
        this.listeners.forEach(cb => cb(this.prompts));
    }
}
