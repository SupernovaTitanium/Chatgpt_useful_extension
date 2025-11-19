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
        this.render();
    }

    render() {
        // Try to find the input area to inject the button
        // ChatGPT input area selector might change. Usually textarea's parent or nearby.
        const textarea = document.querySelector('textarea[id="prompt-textarea"]');
        if (!textarea) return; // Retry later?

        const inputWrapper = textarea.parentElement;
        if (!inputWrapper) return;

        if (document.getElementById('chatgpt-prompts-button')) return;

        const btn = document.createElement('button');
        btn.id = 'chatgpt-prompts-button';
        btn.type = 'button';
        btn.textContent = '⚡';
        btn.title = 'Prompt Toolbox';
        btn.style.cssText = `
            position: absolute;
            left: 10px;
            bottom: 10px;
            width: 30px;
            height: 30px;
            border-radius: 4px;
            background: transparent;
            border: 1px solid #565869;
            color: #8e8ea0;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10;
        `;
        // Adjust position based on ChatGPT layout (usually left side of input)
        // Note: This is brittle. A better place might be the toolbar below input if it exists.

        btn.onclick = () => this.showModal();

        // Append to wrapper (might need relative positioning)
        const wrapperStyle = window.getComputedStyle(inputWrapper);
        if (wrapperStyle.position === 'static') inputWrapper.style.position = 'relative';
        inputWrapper.appendChild(btn);
    }

    showModal() {
        let modal = document.getElementById('chatgpt-prompts-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'chatgpt-prompts-modal';
            modal.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 500px;
                max-height: 80vh;
                background: #202123;
                border: 1px solid #4d4d4f;
                border-radius: 8px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                box-shadow: 0 0 20px rgba(0,0,0,0.5);
                color: white;
            `;

            const header = document.createElement('div');
            header.style.cssText = `
                padding: 15px;
                border-bottom: 1px solid #4d4d4f;
                display: flex;
                justify-content: space-between;
                align-items: center;
            `;
            header.innerHTML = '<h3>Prompt Toolbox</h3>';
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '×';
            closeBtn.style.cssText = 'background:none;border:none;color:white;font-size:20px;cursor:pointer;';
            closeBtn.onclick = () => modal.style.display = 'none';
            header.appendChild(closeBtn);
            modal.appendChild(header);

            const body = document.createElement('div');
            body.id = 'chatgpt-prompts-list';
            body.style.cssText = 'padding: 15px; overflow-y: auto; flex: 1;';
            modal.appendChild(body);

            document.body.appendChild(modal);
        }

        modal.style.display = 'flex';
        this.renderList();
    }

    renderList() {
        const list = document.getElementById('chatgpt-prompts-list');
        if (!list) return;
        list.innerHTML = '';

        this.prompts.forEach(p => {
            const item = document.createElement('div');
            item.style.cssText = `
                padding: 10px;
                background: #343541;
                margin-bottom: 10px;
                border-radius: 4px;
                cursor: pointer;
            `;
            item.innerHTML = `<div style="font-weight:bold;margin-bottom:5px;">${p.title}</div><div style="font-size:0.9em;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.content}</div>`;
            item.onclick = () => {
                const textarea = document.querySelector('textarea[id="prompt-textarea"]');
                if (textarea) {
                    textarea.value = p.content;
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                    textarea.focus();
                    document.getElementById('chatgpt-prompts-modal').style.display = 'none';
                }
            };
            list.appendChild(item);
        });
    }
}
