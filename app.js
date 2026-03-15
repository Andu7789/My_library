// Reading Library App
class ReadingLibrary {
    constructor() {
        this.books = [];
        this.deletedBookIds = []; // Track deleted book IDs to prevent resurrection during merge
        this.settings = {
            githubToken: '',
            gistId: ''
        };
        this.importData = null;
        this.syncInProgress = false;
        this.pendingSync = false;

        this.init();
    }

    init() {
        this.loadSettings();
        this.loadBooks();
        this.setupEventListeners();
        this.updateUI();
        this.setCurrentYear();
        this.updateGistIdDisplay();
    }

    updateGistIdDisplay() {
        const display = document.getElementById('gistIdDisplay');
        if (this.settings.gistId) {
            const shortId = this.settings.gistId.substring(0, 8);
            display.textContent = `Gist: ${shortId}...`;
            display.style.display = 'inline';
        } else {
            display.textContent = 'Not synced';
            display.style.display = 'inline';
        }
    }

    // Data Management
    loadSettings() {
        const saved = localStorage.getItem('librarySettings');
        if (saved) {
            this.settings = JSON.parse(saved);
        }
    }

    saveSettings() {
        localStorage.setItem('librarySettings', JSON.stringify(this.settings));
    }

    loadBooks() {
        const saved = localStorage.getItem('libraryBooks');
        if (saved) {
            this.books = JSON.parse(saved);
        }

        const deletedIds = localStorage.getItem('deletedBookIds');
        if (deletedIds) {
            this.deletedBookIds = JSON.parse(deletedIds);
        }
    }

    saveBooks() {
        localStorage.setItem('libraryBooks', JSON.stringify(this.books));
        localStorage.setItem('deletedBookIds', JSON.stringify(this.deletedBookIds));
        this.updateUI();
    }

    // GitHub Gist Integration
    async syncWithGist(action = 'sync') {
        const { githubToken, gistId } = this.settings;

        if (!githubToken) {
            this.showToast('Please configure GitHub token first', 'error');
            this.openSettings();
            return;
        }

        // Queue mechanism to prevent concurrent syncs
        if (this.syncInProgress) {
            this.pendingSync = true;
            console.log('Sync already in progress, queuing this request');
            return;
        }

        this.syncInProgress = true;
        const syncBtn = document.getElementById('syncBtn');
        syncBtn.classList.add('syncing');
        syncBtn.disabled = true;

        try {
            if (action === 'push') {
                // Force push local data to gist
                await this.pushToGist();
                this.showToast('Pushed to cloud successfully!', 'success');
            } else if (action === 'pull') {
                // Force pull from gist (overwrites local)
                await this.pullFromGist();
                this.showToast('Pulled from cloud successfully!', 'success');
            } else {
                // Smart sync: merge local and remote data
                await this.smartSync();
                this.showToast('Synced successfully!', 'success');
            }
        } catch (error) {
            console.error('Sync error:', error);

            // Show detailed error message to help with troubleshooting
            let errorMsg = error.message;
            if (errorMsg.includes('403')) {
                errorMsg = '403 Forbidden - Token may not have write permission. Try creating a new token at github.com/settings/tokens with "gist" scope.';
            } else if (errorMsg.includes('401')) {
                errorMsg = '401 Unauthorized - Invalid token. Check your GitHub token.';
            } else if (errorMsg.includes('404')) {
                errorMsg = '404 Not Found - Gist ID not found. Check your Gist ID.';
            }

            this.showToast('Sync failed: ' + errorMsg, 'error');
        } finally {
            this.syncInProgress = false;
            syncBtn.classList.remove('syncing');
            syncBtn.disabled = false;

            // If there was a pending sync request, execute it now
            if (this.pendingSync) {
                this.pendingSync = false;
                console.log('Executing pending sync request');
                await this.syncWithGist(action);
            }
        }
    }

    async smartSync() {
        const { gistId } = this.settings;
        console.log(`[SYNC DEBUG] Starting smartSync. GistID: ${gistId ? 'exists' : 'missing'}, Local books: ${this.books.length}, Local deleted: ${this.deletedBookIds.length}`);

        if (!gistId) {
            // No gist exists, create one with current data
            console.log(`[SYNC DEBUG] No Gist ID found, creating new Gist...`);
            await this.pushToGist();
            return;
        }

        // Pull remote data first
        console.log(`[SYNC DEBUG] Fetching remote data from Gist...`);
        const remoteData = await this.fetchGistData();

        // Ensure remoteData has the correct structure
        const remoteBooks = remoteData.books || [];
        const remoteDeletedIds = remoteData.deletedBookIds || [];

        console.log(`[SYNC DEBUG] Smart Sync v2.0: Local=${this.books.length} books, Remote=${remoteBooks.length} books`);
        console.log(`[SYNC DEBUG] Deleted IDs: Local=${this.deletedBookIds.length}, Remote=${remoteDeletedIds.length}`);

        // Merge deleted IDs from both devices
        const mergedDeletedIds = [...new Set([...this.deletedBookIds, ...remoteDeletedIds])];
        console.log(`[SYNC DEBUG] Merged deleted IDs: ${mergedDeletedIds.length}`);
        this.deletedBookIds = mergedDeletedIds;

        // Merge local and remote books
        const mergedBooks = this.mergeBooks(this.books, remoteBooks);
        console.log(`[SYNC DEBUG] Smart Sync v2.0: Merged=${mergedBooks.length} books`);

        // Update local storage with merged data
        this.books = mergedBooks;
        this.saveBooks();
        this.renderBooks();
        console.log(`[SYNC DEBUG] Saved merged books to localStorage`);

        // Push merged data back to gist
        console.log(`[SYNC DEBUG] Pushing merged data back to Gist...`);
        await this.pushToGist();
        console.log(`[SYNC DEBUG] Sync complete!`);
    }

    async fetchGistData() {
        console.log(`[SYNC DEBUG] Fetching Gist ID: ${this.settings.gistId}`);
        const response = await fetch(`https://api.github.com/gists/${this.settings.gistId}`, {
            headers: {
                'Authorization': `token ${this.settings.githubToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) {
            console.error(`[SYNC DEBUG] Failed to fetch Gist. Status: ${response.status} ${response.statusText}`);
            const errorText = await response.text();
            console.error(`[SYNC DEBUG] Error details:`, errorText);
            throw new Error(`Failed to fetch from Gist: ${response.status} ${response.statusText}`);
        }

        const gist = await response.json();
        const content = gist.files['library.json']?.content;
        console.log(`[SYNC DEBUG] Fetched Gist successfully. Has library.json: ${!!content}`);

        if (!content) {
            return { books: [], deletedBookIds: [] };
        }

        const data = JSON.parse(content);

        // Handle old format (just array of books) and new format (object with books and deletedBookIds)
        if (Array.isArray(data)) {
            console.log(`[SYNC DEBUG] Old format detected (array), converting...`);
            return { books: data, deletedBookIds: [] };
        } else {
            console.log(`[SYNC DEBUG] New format: ${data.books?.length || 0} books, ${data.deletedBookIds?.length || 0} deleted IDs`);
            return {
                books: data.books || [],
                deletedBookIds: data.deletedBookIds || []
            };
        }
    }

    mergeBooks(localBooks, remoteBooks) {
        // Create a map of all books by a composite key (title + author + year)
        const bookMap = new Map();

        // Helper to create unique key
        const getKey = (book) =>
            `${book.title.toLowerCase()}|${book.author.toLowerCase()}|${book.year}`;

        // Add all remote books first (excluding deleted ones)
        remoteBooks.forEach(book => {
            // Skip books that have been deleted locally
            if (!this.deletedBookIds.includes(book.id)) {
                bookMap.set(getKey(book), book);
            } else {
                console.log(`[MERGE DEBUG] Skipping deleted book from remote: ${book.title}`);
            }
        });

        // Add or update with local books (local takes precedence for same book)
        localBooks.forEach(book => {
            // Skip books that have been deleted (either locally or remotely)
            if (this.deletedBookIds.includes(book.id)) {
                console.log(`[MERGE DEBUG] Skipping deleted book from local: ${book.title}`);
                return;
            }

            const key = getKey(book);
            const existing = bookMap.get(key);

            // If book exists, keep the one with more recent addedDate
            if (existing) {
                const localDate = new Date(book.addedDate || 0);
                const remoteDate = new Date(existing.addedDate || 0);

                if (localDate >= remoteDate) {
                    bookMap.set(key, book);
                }
            } else {
                bookMap.set(key, book);
            }
        });

        return Array.from(bookMap.values());
    }

    async pullFromGist() {
        const response = await fetch(`https://api.github.com/gists/${this.settings.gistId}`, {
            headers: {
                'Authorization': `token ${this.settings.githubToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch from Gist');
        }

        const gist = await response.json();
        const content = gist.files['library.json']?.content;

        if (content) {
            const data = JSON.parse(content);

            // Handle old format (just array) and new format (object with books and deletedBookIds)
            if (Array.isArray(data)) {
                this.books = data;
                this.deletedBookIds = [];
            } else {
                this.books = data.books || [];
                this.deletedBookIds = data.deletedBookIds || [];
            }

            this.saveBooks();
            this.renderBooks();
        }
    }

    async pushToGist() {
        console.log(`[SYNC DEBUG] Pushing ${this.books.length} books and ${this.deletedBookIds.length} deleted IDs to Gist...`);
        const gistData = {
            description: 'My Reading Library Data',
            public: false,
            files: {
                'library.json': {
                    content: JSON.stringify({
                        books: this.books,
                        deletedBookIds: this.deletedBookIds
                    }, null, 2)
                }
            }
        };

        const url = this.settings.gistId
            ? `https://api.github.com/gists/${this.settings.gistId}`
            : 'https://api.github.com/gists';

        const method = this.settings.gistId ? 'PATCH' : 'POST';
        console.log(`[SYNC DEBUG] Using ${method} to ${url}`);

        const response = await fetch(url, {
            method: method,
            headers: {
                'Authorization': `token ${this.settings.githubToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(gistData)
        });

        if (!response.ok) {
            console.error(`[SYNC DEBUG] Failed to push to Gist. Status: ${response.status} ${response.statusText}`);
            const errorText = await response.text();
            console.error(`[SYNC DEBUG] Error details:`, errorText);
            throw new Error(`Failed to push to Gist: ${response.status} ${response.statusText}`);
        }

        const gist = await response.json();
        console.log(`[SYNC DEBUG] Successfully pushed to Gist. ID: ${gist.id}`);

        if (!this.settings.gistId) {
            this.settings.gistId = gist.id;
            this.saveSettings();
            console.log(`[SYNC DEBUG] New Gist created with ID: ${gist.id}`);
            this.showToast(`Gist created! ID: ${gist.id}`, 'success');
        }
    }

    // Book Management
    async addBook(title, author, year, notes = '') {
        console.log(`[SYNC DEBUG] Adding book: "${title}" by ${author}`);
        const book = {
            id: Date.now().toString(),
            title: title.trim(),
            author: author.trim(),
            year: parseInt(year),
            notes: notes.trim(),
            addedDate: new Date().toISOString()
        };

        this.books.push(book);
        this.saveBooks();
        console.log(`[SYNC DEBUG] Book added to local storage. Total books: ${this.books.length}`);

        // Auto-sync if configured (use smart sync to avoid overwriting)
        if (this.settings.githubToken && this.settings.gistId) {
            console.log(`[SYNC DEBUG] Token and Gist ID found, triggering auto-sync...`);
            await this.syncWithGist('sync');
        } else {
            console.log(`[SYNC DEBUG] No auto-sync: Token=${!!this.settings.githubToken}, GistID=${!!this.settings.gistId}`);
        }

        return book;
    }

    async deleteBook(id) {
        console.log(`[DELETE DEBUG] Deleting book with id: ${id}. Books before: ${this.books.length}`);

        // Track this deletion to prevent the book from being restored during merge
        if (!this.deletedBookIds.includes(id)) {
            this.deletedBookIds.push(id);
            console.log(`[DELETE DEBUG] Added ${id} to deleted list. Total deleted: ${this.deletedBookIds.length}`);
        }

        this.books = this.books.filter(book => book.id !== id);
        console.log(`[DELETE DEBUG] Books after filter: ${this.books.length}`);
        this.saveBooks();

        // Now use smart sync - the merge will filter out deleted books
        if (this.settings.githubToken && this.settings.gistId) {
            console.log(`[DELETE DEBUG] Syncing deletion with smart merge...`);
            await this.syncWithGist('sync');
        }
    }

    findDuplicates(title) {
        return this.books.filter(book =>
            book.title.toLowerCase() === title.toLowerCase()
        );
    }

    // Search and Filter
    searchBooks(query) {
        const lowerQuery = query.toLowerCase();
        return this.books.filter(book =>
            book.title.toLowerCase().includes(lowerQuery) ||
            book.author.toLowerCase().includes(lowerQuery) ||
            book.notes.toLowerCase().includes(lowerQuery)
        );
    }

    getAutocompleteBooks(query) {
        if (!query) return [];
        const lowerQuery = query.toLowerCase();
        return this.books
            .filter(book => book.title.toLowerCase().includes(lowerQuery))
            .slice(0, 5);
    }

    getAutocompleteAuthors(query) {
        if (!query) return [];
        const lowerQuery = query.toLowerCase();
        const authors = [...new Set(this.books.map(book => book.author))];
        return authors
            .filter(author => author.toLowerCase().includes(lowerQuery))
            .slice(0, 5);
    }

    getBooksByAuthor(author) {
        return this.books.filter(book => book.author === author);
    }

    getBooksByYear(year) {
        return this.books.filter(book => book.year === parseInt(year));
    }

    getUniqueYears() {
        const years = [...new Set(this.books.map(book => book.year))];
        return years.sort((a, b) => b - a);
    }

    getYearStats() {
        const stats = {};
        this.books.forEach(book => {
            stats[book.year] = (stats[book.year] || 0) + 1;
        });
        return Object.entries(stats)
            .map(([year, count]) => ({ year: parseInt(year), count }))
            .sort((a, b) => b.year - a.year);
    }

    sortBooks(books, sortBy) {
        const sorted = [...books];

        switch(sortBy) {
            case 'title':
                return sorted.sort((a, b) => a.title.localeCompare(b.title));
            case 'author':
                return sorted.sort((a, b) => a.author.localeCompare(b.author));
            case 'year-desc':
                return sorted.sort((a, b) => b.year - a.year);
            case 'year-asc':
                return sorted.sort((a, b) => a.year - b.year);
            case 'recent':
            default:
                return sorted.sort((a, b) => new Date(b.addedDate) - new Date(a.addedDate));
        }
    }

    // UI Updates
    updateUI() {
        this.updateStats();
        this.updateYearFilter();
        this.renderBooks();
    }

    updateStats() {
        document.getElementById('totalBooks').textContent = this.books.length;

        const uniqueAuthors = new Set(this.books.map(book => book.author));
        document.getElementById('totalAuthors').textContent = uniqueAuthors.size;

        const currentYear = new Date().getFullYear();
        const thisYearBooks = this.books.filter(book => book.year === currentYear);
        document.getElementById('thisYearCount').textContent = thisYearBooks.length;
    }

    updateYearFilter() {
        const yearFilter = document.getElementById('yearFilter');
        const currentValue = yearFilter.value;
        const years = this.getUniqueYears();

        yearFilter.innerHTML = '<option value="">All Years</option>';
        years.forEach(year => {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            yearFilter.appendChild(option);
        });

        yearFilter.value = currentValue;
    }

    renderBooks() {
        const searchQuery = document.getElementById('searchInput').value;
        const yearFilter = document.getElementById('yearFilter').value;
        const sortBy = document.getElementById('sortBy').value;

        let filteredBooks = this.books;

        if (searchQuery) {
            filteredBooks = this.searchBooks(searchQuery);
        }

        if (yearFilter) {
            filteredBooks = filteredBooks.filter(book => book.year === parseInt(yearFilter));
        }

        filteredBooks = this.sortBooks(filteredBooks, sortBy);

        const booksList = document.getElementById('booksList');

        if (filteredBooks.length === 0) {
            booksList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📖</div>
                    <h3>${searchQuery || yearFilter ? 'No books found' : 'No books yet'}</h3>
                    <p>${searchQuery || yearFilter ? 'Try adjusting your filters' : 'Add your first book or import from Excel to get started!'}</p>
                </div>
            `;
            return;
        }

        booksList.innerHTML = filteredBooks.map(book => `
            <div class="book-card" data-id="${book.id}">
                <div class="book-title">${this.escapeHtml(book.title)}</div>
                <div class="book-author" onclick="library.showAuthorBooks('${this.escapeHtml(book.author)}')">
                    ${this.escapeHtml(book.author)}
                </div>
                <div class="book-meta">
                    <span>📅 ${book.year}</span>
                </div>
                ${book.notes ? `<div class="book-notes">"${this.escapeHtml(book.notes)}"</div>` : ''}
                <div class="book-actions">
                    <button class="btn btn-danger btn-small" onclick="library.confirmDelete('${book.id}')">
                        Delete
                    </button>
                </div>
            </div>
        `).join('');
    }

    async confirmDelete(id) {
        console.log(`[DELETE DEBUG] confirmDelete called with id: ${id}`);
        const book = this.books.find(b => b.id === id);
        console.log(`[DELETE DEBUG] Book found:`, book);

        if (book && confirm(`Delete "${book.title}"?`)) {
            console.log(`[DELETE DEBUG] User confirmed deletion`);
            await this.deleteBook(id);
            console.log(`[DELETE DEBUG] Delete completed`);
            this.showToast('Book deleted', 'success');
        } else {
            console.log(`[DELETE DEBUG] Deletion cancelled or book not found`);
        }
    }

    // Autocomplete
    showBookSuggestions(query) {
        const suggestions = document.getElementById('bookSuggestions');
        const matches = this.getAutocompleteBooks(query);

        if (matches.length === 0 || !query) {
            suggestions.classList.add('hidden');
            return;
        }

        const duplicates = this.findDuplicates(query);
        let html = '';

        if (duplicates.length > 0) {
            html += `<div class="suggestion-item warning">
                ⚠️ Already read this book ${duplicates.length} time(s)
            </div>`;
        }

        html += matches.map(book => {
            const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
            const highlighted = book.title.replace(regex, '<span class="suggestion-match">$1</span>');
            return `<div class="suggestion-item" onclick="library.selectBookSuggestion('${this.escapeHtml(book.title)}', '${this.escapeHtml(book.author)}')">
                ${highlighted} <span style="color: var(--text-muted)">by ${this.escapeHtml(book.author)}</span>
            </div>`;
        }).join('');

        suggestions.innerHTML = html;
        suggestions.classList.remove('hidden');
    }

    selectBookSuggestion(title, author) {
        document.getElementById('bookTitle').value = title;
        document.getElementById('bookAuthor').value = author;
        document.getElementById('bookSuggestions').classList.add('hidden');
    }

    showAuthorSuggestions(query) {
        const suggestions = document.getElementById('authorSuggestions');
        const matches = this.getAutocompleteAuthors(query);

        if (matches.length === 0 || !query) {
            suggestions.classList.add('hidden');
            return;
        }

        const html = matches.map(author => {
            const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
            const highlighted = author.replace(regex, '<span class="suggestion-match">$1</span>');
            const bookCount = this.getBooksByAuthor(author).length;
            return `<div class="suggestion-item" onclick="library.selectAuthorSuggestion('${this.escapeHtml(author)}')">
                ${highlighted} <span style="color: var(--text-muted)">(${bookCount} book${bookCount > 1 ? 's' : ''})</span>
            </div>`;
        }).join('');

        suggestions.innerHTML = html;
        suggestions.classList.remove('hidden');
    }

    selectAuthorSuggestion(author) {
        document.getElementById('bookAuthor').value = author;
        document.getElementById('authorSuggestions').classList.add('hidden');
    }

    // Modals
    showAuthorBooks(author) {
        const books = this.getBooksByAuthor(author);
        const modal = document.getElementById('authorBooksModal');
        const title = document.getElementById('authorModalTitle');
        const content = document.getElementById('authorBooksContent');

        title.textContent = `Books by ${author} (${books.length})`;

        const sortedBooks = this.sortBooks(books, 'year-desc');

        content.innerHTML = sortedBooks.map(book => `
            <div class="author-book-item">
                <div class="author-book-title">${this.escapeHtml(book.title)}</div>
                <div class="author-book-year">Read in ${book.year}</div>
                ${book.notes ? `<div class="book-notes" style="margin-top: 8px;">"${this.escapeHtml(book.notes)}"</div>` : ''}
            </div>
        `).join('');

        modal.classList.remove('hidden');
    }

    showYearStats() {
        const stats = this.getYearStats();
        const modal = document.getElementById('yearStatsModal');
        const content = document.getElementById('yearStatsContent');

        content.innerHTML = stats.map(({ year, count }) => `
            <div class="year-stat-item">
                <div class="year-stat-year">${year}</div>
                <div class="year-stat-count">${count} book${count > 1 ? 's' : ''}</div>
            </div>
        `).join('');

        modal.classList.remove('hidden');
    }

    closeModal(modalId) {
        document.getElementById(modalId).classList.add('hidden');
    }

    // Settings
    openSettings() {
        document.getElementById('githubToken').value = this.settings.githubToken;
        document.getElementById('gistId').value = this.settings.gistId;
        document.getElementById('settingsPanel').classList.remove('hidden');
    }

    closeSettings() {
        document.getElementById('settingsPanel').classList.add('hidden');
    }

    async testGitHubConnection() {
        const statusDiv = document.getElementById('connectionStatus');
        const token = document.getElementById('githubToken').value.trim();
        const gistId = document.getElementById('gistId').value.trim();

        if (!token) {
            statusDiv.innerHTML = '<span style="color: #ef4444;">❌ Please enter a GitHub token</span>';
            return;
        }

        statusDiv.innerHTML = '<span style="color: #3b82f6;">⏳ Testing connection...</span>';

        try {
            // Test 1: Check if token is valid
            const userResponse = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!userResponse.ok) {
                statusDiv.innerHTML = '<span style="color: #ef4444;">❌ Invalid token or no internet connection</span>';
                return;
            }

            const userData = await userResponse.json();
            console.log('[TEST] GitHub user:', userData.login);

            // Test 2: If Gist ID provided, try to fetch it
            if (gistId) {
                const gistResponse = await fetch(`https://api.github.com/gists/${gistId}`, {
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });

                if (!gistResponse.ok) {
                    statusDiv.innerHTML = `<span style="color: #ef4444;">❌ Token valid but cannot access Gist ID: ${gistId}</span>`;
                    return;
                }

                const gistData = await gistResponse.json();
                const bookCount = gistData.files['library.json']?.content ?
                    JSON.parse(gistData.files['library.json'].content).books?.length ||
                    JSON.parse(gistData.files['library.json'].content).length : 0;

                statusDiv.innerHTML = `<span style="color: #10b981;">✅ Connected as ${userData.login}. Gist has ${bookCount} books.</span>`;
            } else {
                statusDiv.innerHTML = `<span style="color: #10b981;">✅ Token valid. Connected as ${userData.login}.</span>`;
            }

        } catch (error) {
            console.error('[TEST] Connection error:', error);
            statusDiv.innerHTML = `<span style="color: #ef4444;">❌ Error: ${error.message}</span>`;
        }
    }

    saveSettingsForm() {
        this.settings.githubToken = document.getElementById('githubToken').value.trim();
        this.settings.gistId = document.getElementById('gistId').value.trim();
        this.saveSettings();
        this.updateGistIdDisplay();
        this.closeSettings();

        if (this.settings.githubToken) {
            // Use smart sync to merge data when connecting
            this.syncWithGist('sync');
        }
    }

    // Import from Excel
    openImport() {
        document.getElementById('importPanel').classList.remove('hidden');
        document.getElementById('fileInput').value = '';
        document.getElementById('fileName').textContent = 'Choose file...';
        document.getElementById('importPreview').classList.add('hidden');
        document.getElementById('confirmImport').classList.add('hidden');
    }

    closeImport() {
        document.getElementById('importPanel').classList.add('hidden');
        this.importData = null;
    }

    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        document.getElementById('fileName').textContent = file.name;

        try {
            const data = await this.readExcelFile(file);
            this.importData = data;
            this.showImportPreview(data);
        } catch (error) {
            this.showToast('Error reading file: ' + error.message, 'error');
        }
    }

    readExcelFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const jsonData = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

                    // Try to map columns intelligently
                    const mapped = jsonData.map((row, index) => {
                        // Find title column
                        const titleKey = Object.keys(row).find(key =>
                            key.toLowerCase().includes('title') ||
                            key.toLowerCase().includes('book') ||
                            key.toLowerCase().includes('name')
                        ) || Object.keys(row)[0];

                        // Find author column
                        const authorKey = Object.keys(row).find(key =>
                            key.toLowerCase().includes('author') ||
                            key.toLowerCase().includes('writer')
                        ) || Object.keys(row)[1];

                        // Find year column
                        const yearKey = Object.keys(row).find(key =>
                            key.toLowerCase().includes('year') ||
                            key.toLowerCase().includes('date')
                        ) || Object.keys(row)[2];

                        const title = row[titleKey]?.toString().trim();
                        const author = row[authorKey]?.toString().trim();
                        const year = parseInt(row[yearKey]) || new Date().getFullYear();

                        if (!title || !author) {
                            return null;
                        }

                        return { title, author, year };
                    }).filter(Boolean);

                    resolve(mapped);
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }

    showImportPreview(data) {
        const preview = document.getElementById('importPreview');
        const content = document.getElementById('previewContent');
        const count = document.getElementById('importCount');

        const previewData = data.slice(0, 5);

        content.innerHTML = `
            <table class="preview-table">
                <thead>
                    <tr>
                        <th>Title</th>
                        <th>Author</th>
                        <th>Year</th>
                    </tr>
                </thead>
                <tbody>
                    ${previewData.map(book => `
                        <tr>
                            <td>${this.escapeHtml(book.title)}</td>
                            <td>${this.escapeHtml(book.author)}</td>
                            <td>${book.year}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        count.textContent = data.length;
        preview.classList.remove('hidden');
        document.getElementById('confirmImport').classList.remove('hidden');
    }

    async confirmImportBooks() {
        if (!this.importData || this.importData.length === 0) {
            this.showToast('No data to import', 'error');
            return;
        }

        let imported = 0;
        let skipped = 0;

        // Import all books first (without syncing)
        for (const book of this.importData) {
            // Check for duplicates
            const duplicates = this.findDuplicates(book.title);
            if (duplicates.length > 0) {
                skipped++;
                continue;
            }

            // Add book directly without auto-sync
            const newBook = {
                id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
                title: book.title.trim(),
                author: book.author.trim(),
                year: parseInt(book.year),
                notes: '',
                addedDate: new Date().toISOString()
            };
            this.books.push(newBook);
            imported++;
        }

        // Save all at once
        this.saveBooks();

        // Now sync once after all imports
        if (this.settings.githubToken && this.settings.gistId) {
            await this.syncWithGist('sync');
        }

        this.closeImport();
        this.showToast(`Imported ${imported} books${skipped > 0 ? `, skipped ${skipped} duplicates` : ''}`, 'success');
    }

    // Utility
    setCurrentYear() {
        document.getElementById('yearRead').value = new Date().getFullYear();
    }

    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type}`;
        toast.classList.remove('hidden');

        setTimeout(() => {
            toast.classList.add('hidden');
        }, 3000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Event Listeners Setup
    setupEventListeners() {
        // Form submission
        document.getElementById('addBookForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const title = document.getElementById('bookTitle').value.trim();
            const author = document.getElementById('bookAuthor').value.trim();
            const year = document.getElementById('yearRead').value;
            const notes = document.getElementById('bookNotes').value.trim();

            if (!title || !author || !year) {
                this.showToast('Please fill in all required fields', 'error');
                return;
            }

            await this.addBook(title, author, year, notes);

            // Reset form
            e.target.reset();
            this.setCurrentYear();
            document.getElementById('bookSuggestions').classList.add('hidden');
            document.getElementById('authorSuggestions').classList.add('hidden');

            this.showToast('Book added successfully!', 'success');
        });

        // Autocomplete
        const bookTitleInput = document.getElementById('bookTitle');
        bookTitleInput.addEventListener('input', (e) => {
            this.showBookSuggestions(e.target.value);
        });

        const bookAuthorInput = document.getElementById('bookAuthor');
        bookAuthorInput.addEventListener('input', (e) => {
            this.showAuthorSuggestions(e.target.value);
        });

        // Click outside to close suggestions
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.form-group')) {
                document.getElementById('bookSuggestions').classList.add('hidden');
                document.getElementById('authorSuggestions').classList.add('hidden');
            }
        });

        // Search and filters
        document.getElementById('searchInput').addEventListener('input', () => {
            this.renderBooks();
        });

        document.getElementById('yearFilter').addEventListener('change', () => {
            this.renderBooks();
        });

        document.getElementById('sortBy').addEventListener('change', () => {
            this.renderBooks();
        });

        // Sync button
        document.getElementById('syncBtn').addEventListener('click', () => {
            if (!this.settings.githubToken) {
                this.openSettings();
            } else {
                // Use smart sync by default (merges local and remote)
                this.syncWithGist('sync');
            }
        });

        // Import button
        document.getElementById('importBtn').addEventListener('click', () => {
            this.openImport();
        });

        // Settings button (new dedicated button)
        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.openSettings();
        });

        // Gist ID display - click to copy
        document.getElementById('gistIdDisplay').addEventListener('click', () => {
            if (this.settings.gistId) {
                navigator.clipboard.writeText(this.settings.gistId).then(() => {
                    this.showToast(`Gist ID copied: ${this.settings.gistId}`, 'success');
                }).catch(() => {
                    // Fallback if clipboard API fails
                    prompt('Copy this Gist ID:', this.settings.gistId);
                });
            }
        });

        // Settings
        document.getElementById('testConnection').addEventListener('click', async () => {
            await this.testGitHubConnection();
        });

        document.getElementById('saveSettings').addEventListener('click', () => {
            this.saveSettingsForm();
        });

        document.getElementById('closeSettings').addEventListener('click', () => {
            this.closeSettings();
        });

        // Import
        document.getElementById('fileInput').addEventListener('change', (e) => {
            this.handleFileSelect(e);
        });

        document.getElementById('confirmImport').addEventListener('click', () => {
            this.confirmImportBooks();
        });

        document.getElementById('closeImport').addEventListener('click', () => {
            this.closeImport();
        });

        // Modal close buttons
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                modal.classList.add('hidden');
            });
        });

        // Close modal on background click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.add('hidden');
                }
            });
        });

        // Stats card click
        document.getElementById('thisYearCount').parentElement.addEventListener('click', () => {
            this.showYearStats();
        });

        // Close settings/import panels on background click
        document.querySelectorAll('.settings-panel').forEach(panel => {
            panel.addEventListener('click', (e) => {
                if (e.target === panel) {
                    panel.classList.add('hidden');
                }
            });
        });
    }
}

// Initialize the app
const library = new ReadingLibrary();
