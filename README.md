# Budget & Bill Splitter

A mobile-friendly web app for **splitting bills** and **tracking a monthly budget** — works on iOS and Android in the browser, no install needed.

**Live app:** https://shubhampatel4789.github.io/Billsplit/

## Features

- **Summary** — budget ring (spent / remaining / % used), by-category breakdown, month-vs-last-month comparison, who-owes-whom snapshot, recent expenses
- **Expenses** — search, category filter, month navigation, tap any expense to edit or delete
- **Split / Balances** — add people, split expenses equally or by custom amounts, netted balances, one-tap settle-up
- **Budget** — monthly budget, per-category limits with over-budget warnings, recurring bills
- **Backup** — export/import everything as one JSON file (store it in Google Drive to move between devices)
- **Receipt scanning** — in Add Expense, tap “Scan receipt photo”: the receipt is read on the device itself (OCR) and fills in amount, date, store name, and a category guess. The photo is never uploaded or stored.

## How data works

Data is stored in the browser on each device (localStorage). Use **Budget → Export JSON** to back up, and **Import JSON** to restore the same data on another phone or computer.

## Run locally

Open `index.html` in a browser, or serve the folder with any static server:

```
npx serve .
```
