// folders.js - Logic for managing hierarchical folders

class FolderManager {
    constructor() {
        this.folders = [];
        this.storageKey = 'chatgpt_folders';
        this.listeners = new Set();
    }

    async init() {
        await this.loadFolders();
    }

    async loadFolders() {
        const result = await chrome.storage.local.get(this.storageKey);
        this.folders = result[this.storageKey] || [];
        // Ensure default structure if empty?
        // Structure: { id: string, name: string, parentId: string | null, children: [], chatIds: [] }
    }

    async saveFolders() {
        await chrome.storage.local.set({ [this.storageKey]: this.folders });
        this.notifyListeners();
    }

    createFolder(name, parentId = null) {
        const newFolder = {
            id: crypto.randomUUID(),
            name: name,
            parentId: parentId,
            chatIds: [],
            collapsed: false
        };
        this.folders.push(newFolder);
        this.saveFolders();
        return newFolder;
    }

    deleteFolder(folderId) {
        // Move chats to root or parent? For now, move to root (remove from folder)
        // Recursively delete children?
        const folderIndex = this.folders.findIndex(f => f.id === folderId);
        if (folderIndex === -1) return;

        // Remove this folder
        this.folders.splice(folderIndex, 1);

        // Update any folders that had this as parent (orphan them to root)
        this.folders.forEach(f => {
            if (f.parentId === folderId) f.parentId = null;
        });

        this.saveFolders();
    }

    addChatToFolder(chatId, folderId) {
        const folder = this.folders.find(f => f.id === folderId);
        if (!folder) return;

        // Remove from other folders first (single folder per chat for simplicity)
        this.folders.forEach(f => {
            const idx = f.chatIds.indexOf(chatId);
            if (idx !== -1) f.chatIds.splice(idx, 1);
        });

        if (!folder.chatIds.includes(chatId)) {
            folder.chatIds.push(chatId);
        }
        this.saveFolders();
    }

    removeChatFromFolder(chatId, folderId) {
        const folder = this.folders.find(f => f.id === folderId);
        if (!folder) return;
        const idx = folder.chatIds.indexOf(chatId);
        if (idx !== -1) {
            folder.chatIds.splice(idx, 1);
            this.saveFolders();
        }
    }

    getFolderForChat(chatId) {
        return this.folders.find(f => f.chatIds.includes(chatId));
    }

    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    notifyListeners() {
        this.listeners.forEach(cb => cb(this.folders));
        this.render();
    }

    render() {
        console.log('[ChatGPT Enhancer] FolderManager.render called');
        let container = document.getElementById('chatgpt-folders-sidebar');
        if (!container) {
            container = document.createElement('div');
            container.id = 'chatgpt-folders-sidebar';
            container.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                bottom: 0;
                width: 260px;
                background-color: #202123;
                border-right: 1px solid #4d4d4f;
                z-index: 9999;
                transform: translateX(-100%);
                transition: transform 0.3s ease;
                display: flex;
                flex-direction: column;
                padding: 10px;
                color: white;
            `;

            // Toggle button
            const toggleBtn = document.createElement('button');
            toggleBtn.textContent = '📁';
            toggleBtn.title = 'Folders';
            toggleBtn.style.cssText = `
                position: fixed;
                left: 0;
                top: 50%;
                width: 40px;
                height: 50px;
                background: #202123;
                border: 1px solid #4d4d4f;
                border-left: none;
                border-radius: 0 8px 8px 0;
                color: white;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                font-size: 20px;
                box-shadow: 2px 0 5px rgba(0,0,0,0.2);
            `;
            toggleBtn.onclick = () => {
                const isOpen = container.style.transform === 'translateX(0px)';
                container.style.transform = isOpen ? 'translateX(-100%)' : 'translateX(0px)';
                // Move toggle button with sidebar
                toggleBtn.style.left = isOpen ? '0' : '260px';
            };
            document.body.appendChild(toggleBtn);

            // Close button inside sidebar
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '×';
            closeBtn.style.cssText = `
                position: absolute;
                right: 10px;
                top: 10px;
                background: none;
                border: none;
                color: #999;
                cursor: pointer;
                font-size: 20px;
            `;
            closeBtn.onclick = () => {
                container.style.transform = 'translateX(-100%)';
                toggleBtn.style.left = '0';
            };
            container.appendChild(closeBtn);

            // Title
            const title = document.createElement('h3');
            title.textContent = 'Folders';
            title.style.marginBottom = '10px';
            container.appendChild(title);

            // Add Folder Button
            const addBtn = document.createElement('button');
            addBtn.textContent = '+ New Folder';
            addBtn.style.cssText = `
                background: #343541;
                border: 1px solid #565869;
                color: white;
                padding: 8px;
                border-radius: 4px;
                cursor: pointer;
                margin-bottom: 10px;
            `;
            addBtn.onclick = () => {
                const name = prompt('Folder Name:');
                if (name) this.createFolder(name);
            };
            container.appendChild(addBtn);

            // List
            const list = document.createElement('div');
            list.id = 'chatgpt-folders-list';
            list.style.cssText = `
                flex: 1;
                overflow-y: auto;
            `;
            container.appendChild(list);

            document.body.appendChild(container);
        }

        const list = container.querySelector('#chatgpt-folders-list');
        list.innerHTML = '';

        this.folders.forEach(folder => {
            const item = document.createElement('div');
            item.style.cssText = `
                padding: 8px;
                background: #343541;
                margin-bottom: 5px;
                border-radius: 4px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            `;

            const nameSpan = document.createElement('span');
            nameSpan.textContent = folder.name;
            item.appendChild(nameSpan);

            const delBtn = document.createElement('button');
            delBtn.textContent = '×';
            delBtn.style.cssText = `
                background: none;
                border: none;
                color: #999;
                cursor: pointer;
                font-size: 16px;
            `;
            delBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`Delete folder "${folder.name}"?`)) this.deleteFolder(folder.id);
            };
            item.appendChild(delBtn);

            list.appendChild(item);
        });
    }
}

// Export singleton
// window.FolderManager = new FolderManager(); 
// We will instantiate this in content script
