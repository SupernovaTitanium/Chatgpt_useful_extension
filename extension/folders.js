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
    }
}

// Export singleton
// window.FolderManager = new FolderManager(); 
// We will instantiate this in content script
