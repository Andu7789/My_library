# 📚 My Reading Library

A beautiful, mobile-friendly web application to track the books you've read. Features smart autocomplete to prevent re-reading books, author organization, yearly statistics, and cross-device sync via Supabase.

## ✨ Features

- **Smart Duplicate Detection**: Start typing a book title and get warned if you've already read it
- **Author Management**: View all books by a specific author with one click
- **Yearly Statistics**: Track how many books you read each year
- **Cross-Platform Sync**: Save your library to Supabase and access it from any device
- **Excel Import**: Import your existing book collection from XLS/XLSX files
- **Beautiful UI**: Modern, dark-themed interface that works on desktop and mobile
- **Search & Filter**: Find books quickly with search and year filters
- **Autocomplete**: Smart suggestions for book titles and authors as you type
- **Notes**: Add personal notes to any book

## 🚀 Quick Start

### Option 1: Local Use (No Setup Required)

1. Download or clone this repository
2. Open `index.html` in any modern web browser
3. Start adding books!

Your data will be saved in your browser's local storage.

### Option 2: With Supabase Sync (Recommended)

For cross-device synchronization:

1. **Create a Supabase Project**:
   - Go to https://supabase.com/dashboard and create a free project
   - Once it's ready, open **Project Settings → API** and note your **Project URL** and **anon/public API key**

2. **Create the `books` table**:
   - Open the **SQL Editor** in your Supabase project
   - Run:
     ```sql
     create table if not exists books (
       id text primary key,
       title text not null,
       author text not null,
       year integer not null,
       notes text default '',
       added_date timestamptz default now()
     );

     alter table books enable row level security;

     create policy "Allow anonymous access" on books
       for all using (true) with check (true);
     ```

3. **Configure the App**:
   - Open the app in your browser
   - Click the "Sync" button (or the ⚙️ settings button)
   - Paste your Supabase Project URL and API key
   - Click "Save & Sync"

4. **On Other Devices**:
   - Open the app
   - Click "Sync"
   - Enter the same Supabase Project URL and API key
   - Click "Save & Sync" to pull your data

## 📥 Importing Your Existing Data

If you have an Excel file with your books:

1. Click the "Import XLS" button
2. Select your Excel file (.xls or .xlsx)
3. The app will automatically detect columns for:
   - Book Title (looks for "title", "book", or "name")
   - Author (looks for "author" or "writer")
   - Year (looks for "year" or "date")
4. Preview the first 5 rows to verify
5. Click "Import Books"

**Excel Format Tips**:
- Any column order works - the app auto-detects
- Duplicate books are automatically skipped
- Missing years default to the current year

**Example Excel Format**:
```
| Book Title                | Author           | Year |
|---------------------------|------------------|------|
| The Great Gatsby          | F. Scott Fitzgerald | 2023 |
| 1984                      | George Orwell    | 2023 |
| To Kill a Mockingbird     | Harper Lee       | 2024 |
```

## 💡 How to Use

### Adding a Book

1. Fill in the book title, author, and year read
2. As you type the title, you'll see:
   - ⚠️ Warning if you've already read this book
   - Suggestions for similar books in your library
3. Author field also has autocomplete with book counts
4. Optionally add notes (your thoughts, rating, etc.)
5. Click "Add Book"

### Finding Books

- **Search**: Type in the search box to find books by title, author, or notes
- **Filter by Year**: Use the year dropdown to see books from a specific year
- **Sort**: Choose how to sort (Recently Added, Title, Author, Year)
- **View by Author**: Click any author name to see all their books

### Managing Your Library

- **Delete**: Click the delete button on any book card
- **Sync**: Click the sync button to save/load from Supabase
- **Stats**: Click the "This Year" stat card to see yearly reading statistics

## 🎨 Design Features

- **Dark Theme**: Easy on the eyes with a modern gradient background
- **Responsive**: Works perfectly on phones, tablets, and desktops
- **Smooth Animations**: Polished interactions throughout
- **Smart Autocomplete**: Prevents duplicate entries
- **Visual Feedback**: Toast notifications for all actions

## 🔧 Technical Details

### Data Storage

- **Local**: Uses browser localStorage for instant access
- **Cloud**: Optional Supabase integration for backup and sync
- **Format**: A `books` table in Postgres, one row per book

### Data Structure

```json
{
  "id": "unique-timestamp",
  "title": "Book Title",
  "author": "Author Name",
  "year": 2024,
  "notes": "Optional notes",
  "addedDate": "2024-01-15T10:30:00.000Z"
}
```

### Browser Compatibility

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

### Dependencies

- **SheetJS (xlsx)**: For Excel import functionality
- **Supabase REST API**: For database synchronization
- **Google Fonts (Inter)**: For typography

All dependencies are loaded via CDN - no installation required.

## 🔒 Privacy & Security

- Your Supabase API key is stored only in your browser's localStorage
- Data is never sent to any server except your own Supabase project (if you enable sync)
- You can use the app completely offline with local storage only
- The `anon` API key is safe to use client-side, but relies on the Row Level Security policy you set on the `books` table — the setup SQL above grants full read/write to anyone holding that key, matching a personal single-user setup. Don't share your API key or make the repo public with the key hardcoded in it.

## 📱 Mobile Installation (PWA)

You can "install" this app on your phone for a native app experience:

**iOS**:
1. Open in Safari
2. Tap the Share button
3. Select "Add to Home Screen"

**Android**:
1. Open in Chrome
2. Tap the menu (⋮)
3. Select "Add to Home Screen"

## 🛠️ Customization

Want to modify the app? Here's the structure:

- `index.html` - Main structure
- `styles.css` - All styling (easy to modify colors in `:root` variables)
- `app.js` - All functionality

### Changing Colors

Edit the CSS variables in `styles.css`:

```css
:root {
    --primary-color: #6366f1;  /* Main accent color */
    --background: #0f172a;      /* Background color */
    --surface: #1e293b;         /* Card background */
    /* ... more variables ... */
}
```

## 🐛 Troubleshooting

**Books not syncing?**
- Check your Supabase Project URL and API key are correct
- Verify the `books` table exists (see setup SQL above)
- Check your internet connection

**Import not working?**
- Make sure your Excel file has headers in the first row
- Verify columns contain text (not formulas)
- Try a smaller file first to test

**Autocomplete not showing?**
- Need at least one book in the library first
- Make sure you're typing at least one character

## 📄 License

Free to use and modify for personal use.

## 🤝 Contributing

Feel free to fork and improve! Some ideas:
- Add book covers via API
- Reading goals and progress tracking
- Export to PDF/CSV
- Tags and categories
- Reading time tracking
- Social sharing

## 💬 Support

Found a bug or have a suggestion? Open an issue on GitHub!

---

**Happy Reading! 📖✨**
