// Reading Library App

// Public Supabase project URL and anon/public key. The anon key is safe to
// ship in client-side code - it has no privileges beyond what row-level
// security on the "books" table allows.
const DEFAULT_SUPABASE_URL = 'https://rmooksnngqyzqraeicvr.supabase.co';
const DEFAULT_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtb29rc25uZ3F5enFyYWVpY3ZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3OTU2NDgsImV4cCI6MjA4NTM3MTY0OH0.N4COImAWUpLz7yS4OJM4Tgsew-On6s_5ee0_F6pw3-c';

class ReadingLibrary {
    constructor() {
        this.books = [];
        this.settings = {
            supabaseUrl: DEFAULT_SUPABASE_URL,
            supabaseKey: DEFAULT_SUPABASE_KEY
        };
        this.importData = null;
        this.syncInProgress = false;
        this.pendingSync = false;
        this.activeAuthorFilter = '';

        this.init();
    }

    init() {
        this.loadSettings();
        this.loadBooks();
        this.setupEventListeners();
        this.updateUI();
        this.setCurrentYear();
        this.updateConnectionDisplay();
    }

    updateConnectionDisplay() {
        const display = document.getElementById('connectionDisplay');
        if (this.settings.supabaseUrl && this.settings.supabaseKey) {
            display.textContent = 'Connected';
            display.style.display = 'inline';
        } else {
            display.textContent = 'Not synced';
            display.style.display = 'inline';
        }
    }

    // Data Management
    loadSettings() {
        const saved = localStorage.getItem('librarySettings');
        if (!saved) return;

        let parsed;
        try {
            parsed = JSON.parse(saved);
        } catch (e) {
            return;
        }

        // Only trust saved values that are actual non-empty strings, so
        // leftover data from the old GitHub Gist sync (or any other stale
        // shape) can't wipe out the built-in defaults.
        if (typeof parsed.supabaseUrl === 'string' && parsed.supabaseUrl.trim()) {
            this.settings.supabaseUrl = parsed.supabaseUrl.trim();
        }
        if (typeof parsed.supabaseKey === 'string' && parsed.supabaseKey.trim()) {
            this.settings.supabaseKey = parsed.supabaseKey.trim();
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
    }

    saveBooks() {
        localStorage.setItem('libraryBooks', JSON.stringify(this.books));
        this.updateUI();
    }

    // Supabase Integration
    async syncWithSupabase(action = 'sync') {
        const { supabaseUrl, supabaseKey } = this.settings;

        if (!supabaseUrl || !supabaseKey) {
            this.showToast('Please configure Supabase connection first', 'error');
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
                // Force push local data to Supabase
                await this.pushAllToSupabase();
                this.showToast('Pushed to cloud successfully!', 'success');
            } else if (action === 'pull') {
                // Force pull from Supabase (overwrites local)
                await this.pullFromSupabase();
                this.showToast('Pulled from cloud successfully!', 'success');
            } else {
                // Smart sync: push local-only books, then refresh from the authoritative remote table
                await this.smartSync();
                this.showToast('Synced successfully!', 'success');
            }
        } catch (error) {
            console.error('Sync error:', error);

            // Show detailed error message to help with troubleshooting
            let errorMsg = error.message;
            if (errorMsg.includes('401') || errorMsg.includes('403')) {
                errorMsg = 'Unauthorized - Check your Supabase URL and API key.';
            } else if (errorMsg.includes('404')) {
                errorMsg = '404 Not Found - Check your Supabase URL, or make sure the "books" table exists.';
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
                await this.syncWithSupabase(action);
            }
        }
    }

    getSupabaseHeaders(extra = {}) {
        return {
            'apikey': this.settings.supabaseKey,
            'Authorization': `Bearer ${this.settings.supabaseKey}`,
            'Content-Type': 'application/json',
            ...extra
        };
    }

    normalizeSupabaseUrl(url) {
        // Accept either the bare project URL or one with a trailing /rest/v1(/) already on it
        return url.trim().replace(/\/?(rest\/v1\/?)?\/?$/, '');
    }

    getBooksUrl(query = '') {
        return `${this.normalizeSupabaseUrl(this.settings.supabaseUrl)}/rest/v1/books${query}`;
    }

    toRemoteBook(book) {
        return {
            id: book.id,
            title: book.title,
            author: book.author,
            year: book.year,
            notes: book.notes || '',
            added_date: book.addedDate
        };
    }

    fromRemoteBook(row) {
        return {
            id: row.id,
            title: row.title,
            author: row.author,
            year: row.year,
            notes: row.notes || '',
            addedDate: row.added_date
        };
    }

    async smartSync() {
        console.log(`[SYNC DEBUG] Starting smartSync. Local books: ${this.books.length}`);

        const remoteBooks = await this.fetchSupabaseBooks();
        const remoteIds = new Set(remoteBooks.map(b => b.id));

        // Push any books that only exist locally (e.g. added while offline)
        const localOnly = this.books.filter(b => !remoteIds.has(b.id));
        console.log(`[SYNC DEBUG] Remote=${remoteBooks.length} books, local-only to push=${localOnly.length}`);

        for (const book of localOnly) {
            await this.insertSupabaseBook(book);
        }

        // Supabase is the source of truth; refresh local cache from it
        this.books = localOnly.length > 0 ? await this.fetchSupabaseBooks() : remoteBooks;
        this.saveBooks();
        this.renderBooks();
        console.log(`[SYNC DEBUG] Sync complete! Total books: ${this.books.length}`);
    }

    async fetchSupabaseBooks() {
        console.log(`[SYNC DEBUG] Fetching books from Supabase...`);
        const response = await fetch(this.getBooksUrl('?select=*&order=added_date.desc'), {
            headers: this.getSupabaseHeaders()
        });

        if (!response.ok) {
            console.error(`[SYNC DEBUG] Failed to fetch from Supabase. Status: ${response.status} ${response.statusText}`);
            const errorText = await response.text();
            console.error(`[SYNC DEBUG] Error details:`, errorText);
            throw new Error(`Failed to fetch from Supabase: ${response.status} ${response.statusText}`);
        }

        const rows = await response.json();
        console.log(`[SYNC DEBUG] Fetched ${rows.length} books from Supabase`);
        return rows.map(row => this.fromRemoteBook(row));
    }

    async pullFromSupabase() {
        this.books = await this.fetchSupabaseBooks();
        this.saveBooks();
        this.renderBooks();
    }

    async pushAllToSupabase() {
        if (this.books.length === 0) return;
        console.log(`[SYNC DEBUG] Pushing ${this.books.length} books to Supabase...`);

        const response = await fetch(this.getBooksUrl(), {
            method: 'POST',
            headers: this.getSupabaseHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
            body: JSON.stringify(this.books.map(b => this.toRemoteBook(b)))
        });

        if (!response.ok) {
            console.error(`[SYNC DEBUG] Failed to push to Supabase. Status: ${response.status} ${response.statusText}`);
            const errorText = await response.text();
            console.error(`[SYNC DEBUG] Error details:`, errorText);
            throw new Error(`Failed to push to Supabase: ${response.status} ${response.statusText}`);
        }
    }

    async insertSupabaseBook(book) {
        const response = await fetch(this.getBooksUrl(), {
            method: 'POST',
            headers: this.getSupabaseHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
            body: JSON.stringify(this.toRemoteBook(book))
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[SYNC DEBUG] Failed to save book to Supabase:`, errorText);
            throw new Error(`Failed to save book to Supabase: ${response.status} ${response.statusText}`);
        }
    }

    async deleteSupabaseBook(id) {
        const response = await fetch(this.getBooksUrl(`?id=eq.${encodeURIComponent(id)}`), {
            method: 'DELETE',
            headers: this.getSupabaseHeaders()
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[SYNC DEBUG] Failed to delete book from Supabase:`, errorText);
            throw new Error(`Failed to delete book from Supabase: ${response.status} ${response.statusText}`);
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

        // Auto-sync if configured
        if (this.settings.supabaseUrl && this.settings.supabaseKey) {
            console.log(`[SYNC DEBUG] Supabase configured, pushing new book...`);
            try {
                await this.insertSupabaseBook(book);
            } catch (error) {
                console.error('[SYNC DEBUG] Failed to sync new book:', error);
                this.showToast('Saved locally, but failed to sync: ' + error.message, 'error');
            }
        } else {
            console.log(`[SYNC DEBUG] No auto-sync: Supabase not configured`);
        }

        return book;
    }

    async deleteBook(id) {
        console.log(`[DELETE DEBUG] Deleting book with id: ${id}. Books before: ${this.books.length}`);

        this.books = this.books.filter(book => book.id !== id);
        console.log(`[DELETE DEBUG] Books after filter: ${this.books.length}`);
        this.saveBooks();

        if (this.settings.supabaseUrl && this.settings.supabaseKey) {
            console.log(`[DELETE DEBUG] Syncing deletion to Supabase...`);
            try {
                await this.deleteSupabaseBook(id);
            } catch (error) {
                console.error('[DELETE DEBUG] Failed to sync deletion:', error);
                this.showToast('Deleted locally, but failed to sync: ' + error.message, 'error');
            }
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

        if (this.activeAuthorFilter) {
            filteredBooks = filteredBooks.filter(book => book.author === this.activeAuthorFilter);
            document.getElementById('clearAuthorFilter').classList.remove('hidden');
        } else {
            document.getElementById('clearAuthorFilter').classList.add('hidden');
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
                <div class="book-author" data-author="${this.escapeHtml(book.author)}" onclick="library.showAuthorBooks(this.dataset.author)">
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
            return `<div class="suggestion-item" data-title="${this.escapeHtml(book.title)}" data-author="${this.escapeHtml(book.author)}" onclick="library.selectBookSuggestion(this.dataset.title, this.dataset.author)">
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
            return `<div class="suggestion-item" data-author="${this.escapeHtml(author)}" onclick="library.selectAuthorSuggestion(this.dataset.author)">
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
    async showAuthorBooks(author) {
        const readBooks = this.getBooksByAuthor(author);
        const modal = document.getElementById('authorBooksModal');
        const title = document.getElementById('authorModalTitle');
        const readContent = document.getElementById('authorBooksRead');
        const unreadContent = document.getElementById('authorBooksUnread');

        title.textContent = author;
        modal.classList.remove('hidden');

        // Render read books immediately
        const sortedRead = this.sortBooks(readBooks, 'year-desc');
        readContent.innerHTML = sortedRead.length
            ? sortedRead.map(book => `
                <div class="author-book-item">
                    <div class="author-book-title">${this.escapeHtml(book.title)}</div>
                    <div class="author-book-year">Read in ${book.year}</div>
                    ${book.notes ? `<div class="book-notes">"${this.escapeHtml(book.notes)}"</div>` : ''}
                </div>`).join('')
            : '<div class="author-book-empty">No books recorded yet.</div>';

        // Show loading state for unread
        unreadContent.innerHTML = '<div class="author-books-loading"><span class="loading-spinner"></span> Fetching from Open Library...</div>';

        try {
            const readTitles = new Set(readBooks.map(b => b.title.toLowerCase().trim()));
            const query = encodeURIComponent(author);
            const res = await fetch(`https://openlibrary.org/search.json?author=${query}&fields=title,first_publish_year,edition_count&limit=100&sort=editions`);
            if (!res.ok) throw new Error('API error');
            const data = await res.json();

            const unread = (data.docs || [])
                .filter(book => book.title && !readTitles.has(book.title.toLowerCase().trim()))
                .sort((a, b) => (a.first_publish_year || 9999) - (b.first_publish_year || 9999))
                .slice(0, 20);

            unreadContent.innerHTML = unread.length
                ? unread.map(book => `
                    <div class="author-book-item author-book-item-unread">
                        <div class="author-book-title">${this.escapeHtml(book.title)}</div>
                        ${book.first_publish_year ? `<div class="author-book-year">First published ${book.first_publish_year}</div>` : ''}
                    </div>`).join('')
                : '<div class="author-book-empty">No additional books found on Open Library.</div>';
        } catch (e) {
            unreadContent.innerHTML = '<div class="author-book-empty">Could not load books — check your connection.</div>';
        }
    }

    showYearStats() {
        const stats = this.getYearStats();
        const modal = document.getElementById('yearStatsModal');
        const content = document.getElementById('yearStatsContent');

        content.innerHTML = stats.map(({ year, count }) => `
            <div class="year-stat-item" onclick="library.filterByYear(${year})" style="cursor:pointer;">
                <div class="year-stat-year">${year}</div>
                <div class="year-stat-count">${count} book${count > 1 ? 's' : ''}</div>
            </div>
        `).join('');

        modal.classList.remove('hidden');
    }

    filterByYear(year) {
        this.closeModal('yearStatsModal');
        document.getElementById('yearFilter').value = year;
        this.renderBooks();
    }

    showAuthorStats() {
        const modal = document.getElementById('authorStatsModal');
        const content = document.getElementById('authorStatsContent');

        const authorStats = [...new Set(this.books.map(b => b.author))]
            .map(author => ({ author, count: this.books.filter(b => b.author === author).length }))
            .sort((a, b) => b.count - a.count);

        content.innerHTML = authorStats.map(({ author, count }) => `
            <div class="year-stat-item" data-author="${this.escapeHtml(author)}" onclick="library.closeModal('authorStatsModal'); library.showAuthorBooks(this.dataset.author)" style="cursor:pointer;">
                <div class="year-stat-year" style="font-size:0.95rem;">${this.escapeHtml(author)}</div>
                <div class="year-stat-count">${count} book${count > 1 ? 's' : ''}</div>
            </div>
        `).join('');

        modal.classList.remove('hidden');
    }

    filterByAuthor(author) {
        this.closeModal('authorStatsModal');
        this.activeAuthorFilter = author;
        this.renderBooks();
    }

    closeModal(modalId) {
        document.getElementById(modalId).classList.add('hidden');
    }

    // Settings
    openSettings() {
        document.getElementById('supabaseUrl').value = this.settings.supabaseUrl;
        document.getElementById('supabaseKey').value = this.settings.supabaseKey;
        document.getElementById('settingsPanel').classList.remove('hidden');
    }

    closeSettings() {
        document.getElementById('settingsPanel').classList.add('hidden');
    }

    async testSupabaseConnection() {
        const statusDiv = document.getElementById('connectionStatus');
        const url = document.getElementById('supabaseUrl').value.trim();
        const key = document.getElementById('supabaseKey').value.trim();

        if (!url || !key) {
            statusDiv.innerHTML = '<span style="color: #ef4444;">❌ Please enter both Supabase URL and API key</span>';
            return;
        }

        statusDiv.innerHTML = '<span style="color: #3b82f6;">⏳ Testing connection...</span>';

        try {
            const response = await fetch(`${this.normalizeSupabaseUrl(url)}/rest/v1/books?select=id`, {
                headers: {
                    'apikey': key,
                    'Authorization': `Bearer ${key}`,
                    'Prefer': 'count=exact',
                    'Range': '0-0'
                }
            });

            if (!response.ok) {
                statusDiv.innerHTML = `<span style="color: #ef4444;">❌ Connection failed: ${response.status} ${response.statusText}. Check your URL/key, and make sure the "books" table exists.</span>`;
                return;
            }

            const range = response.headers.get('content-range');
            const total = range ? range.split('/')[1] : '?';
            statusDiv.innerHTML = `<span style="color: #10b981;">✅ Connected! Table has ${total} books.</span>`;

        } catch (error) {
            console.error('[TEST] Connection error:', error);
            statusDiv.innerHTML = `<span style="color: #ef4444;">❌ Error: ${error.message}</span>`;
        }
    }

    saveSettingsForm() {
        this.settings.supabaseUrl = document.getElementById('supabaseUrl').value.trim();
        this.settings.supabaseKey = document.getElementById('supabaseKey').value.trim();
        this.saveSettings();
        this.updateConnectionDisplay();
        this.closeSettings();

        if (this.settings.supabaseUrl && this.settings.supabaseKey) {
            // Use smart sync to merge data when connecting
            this.syncWithSupabase('sync');
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
        if (this.settings.supabaseUrl && this.settings.supabaseKey) {
            await this.syncWithSupabase('sync');
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
            if (!this.settings.supabaseUrl || !this.settings.supabaseKey) {
                this.openSettings();
            } else {
                // Use smart sync by default (merges local and remote)
                this.syncWithSupabase('sync');
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

        // Connection status display - click to open settings
        document.getElementById('connectionDisplay').addEventListener('click', () => {
            this.openSettings();
        });

        // Settings
        document.getElementById('testConnection').addEventListener('click', async () => {
            await this.testSupabaseConnection();
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

        document.getElementById('totalAuthors').parentElement.addEventListener('click', () => {
            this.showAuthorStats();
        });

        document.getElementById('clearAuthorFilter').addEventListener('click', () => {
            this.activeAuthorFilter = '';
            this.renderBooks();
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
