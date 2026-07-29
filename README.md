# Nora

Nora is an early web app idea for keeping track of fridge inventory through a simple chat window.

## Starting Problem

Right now, it is hard to remember what is actually in the fridge. Food gets forgotten, ingredients expire, duplicates get bought, and meal planning becomes guesswork.

The first goal is simple: make updating and checking fridge inventory feel as easy as texting someone.

## Core Idea

The app should have a chat-first interface where the user can type natural messages like:

- "I bought milk, eggs, spinach, and chicken."
- "Used the last of the tomatoes."
- "Do I still have yogurt?"
- "What should I cook before it goes bad?"
- "Add two packs of tofu expiring next Friday."
- "Costco full fat milk x3, expires in roughly 3 months."

Nora should understand those messages and keep an inventory list up to date.

Nora should also be able to chat with an AI agent for higher-level help that goes beyond inventory edits. For example: "Help me come up with a few quick dinner ideas that I can get done in 30 minutes, as well as the recipe."

For open-ended questions such as "What can I make right now?", Nora should pass the user's question and relevant inventory context to ChatGPT rather than implement its own meal-planning logic. The context may include current inventory, soon-to-expire items, relevant past inventory activity, household preferences, and the user's time limit. ChatGPT should provide practical meal options and concise recipes. Advice requests should not change inventory unless the user explicitly asks Nora to do so.

Items marked expired or determined to be definitely expired are not usable inventory. Nora must exclude them from the context it sends for meal ideas, recipes, substitutions, and other food recommendations. They may remain in the inventory only for review, discard, or correction; Nora must never recommend consuming them.

Nora should also use past inventory activity to make higher-level shopping recommendations when the user asks. For example, if the user regularly buys and keeps full-fat milk in the fridge, Nora can suggest adding it to the shopping list when supplies are low or absent. Nora should not proactively add items or interrupt the user with these recommendations; they are available on request.

Nora should also handle imperfect expiration information. If the user gives a rough estimate like "Costco full fat milk x3, expire in 3 months," the app should make a good-faith guess instead of asking for an exact date every time. Manual expiration information takes priority when it is available, including a best-by date read from a user-uploaded image; otherwise Nora uses an AI estimate.

For that example, Nora should infer:

- Item: Costco full fat milk
- Quantity: 3
- Expiration: about 3 months from the date added
- Expiration confidence: approximate / user-estimated

Display the inferred calendar date while preserving its source and uncertainty: mark an AI-derived date as **AI estimated** and a user-provided or image-read date as **exact**.

Nora must know the current date and time, including the household's configured time zone. Use this as the authoritative reference for calculating relative dates (such as "in 3 months" or "next Friday"), determining whether items are expiring soon or definitely expired, and timestamping inventory and debug logs.

## Future-Proof Inventory Model

Nora starts with the fridge, but the underlying inventory should support the whole home from day one. The fridge should be a default location and view, not a constraint built into every item.

Each inventory record should be able to store:

- **Item identity**: display name, normalized name, brand, and optional notes.
- **Quantity and unit**: amount, unit, and status such as available, low, empty, consumed, or discarded. Units must be stored alongside quantities, supporting countable units (`3 cartons`), weight (`500 g`), volume (`1 L`), and household units (`1 bunch`, `half a jar`). Preserve the user's original unit when practical.
- **Location**: a flexible hierarchy such as `Kitchen > Fridge > Top Shelf`, `Kitchen > Pantry > Spice Rack`, or `Bathroom > Cabinet`.
- **Category**: for example dairy, produce, meat, spice, cleaning supply, or medicine. Categories should be editable rather than limited to food.
- **Storage details**: optional container, shelf, bin, or room information.
- **Dates and freshness**: added date, expiration or best-by date, source (user-provided, image-read, or AI-estimated), and precision/confidence (`exact`, `approximate`, or `unknown`).
- **Source and history**: how the item was added (chat, photo, barcode, receipt, or manual entry) and a log of later changes.

This lets a single inventory system expand naturally to pantry staples, spices, freezer items, household supplies, and other rooms, while keeping the initial fridge experience clean and simple.

## Data Storage

Use a relational, SQL-compatible data model for maximum portability. SQLite is the preferred starting database because it runs locally with minimal setup, supports reliable persistence, and can later be migrated to a server-hosted SQL database if Nora gains accounts or household sharing.

The schema should keep inventory items, locations, inventory edit logs, and debug logs in separate related tables. Avoid storing the whole inventory as one unstructured document so filtering by location, showing expiring items, reviewing history, and expanding to the whole house remain straightforward.

The database is the canonical inventory record. Nora should provide a neatly arranged, human-readable web view that reflects the same item details, locations, quantities, freshness information, and statuses stored in the database. This view should be derived from the database rather than maintained as a separate editable copy, so it stays in sync after every change.

## AI and Image Handling

Nora may use the ChatGPT API to interpret user-uploaded photos of groceries, fridge contents, pantry shelves, or receipts, then propose inventory additions for the user to confirm.

If the ChatGPT API is unavailable, image-capable access is not enabled on the account, or image analysis otherwise fails, Nora must clearly notify the user that the image feature is temporarily down. It should not silently fail or claim that an image was processed. The debug log should capture the failure details without exposing sensitive credentials.

## AI Text-to-Inventory

ChatGPT is Nora's primary text-to-inventory interpreter. Every chat message is sent to the AI with the relevant current inventory, location list, recent edits, and household preferences as context. Nora should allow the AI to make good-faith assumptions for vague wording instead of repeatedly requiring exact details.

The AI must return a typed, structured action rather than free-form data. Supported actions should include adding, consuming, updating, moving, discarding, or querying items, plus non-inventory replies such as cooking advice. A structured inventory action should contain the affected items, quantity and unit, location, freshness estimate and precision, assumptions made, and confidence.

Nora's backend must validate the AI action against the inventory schema and execute accepted changes in a single SQL transaction. The AI never receives direct database access. Nora should provide the current date, time, and configured time zone as context, while the backend remains authoritative for relative-date calculations and expiration checks. After an automatic change, Nora should show a short human-readable receipt describing what it recorded and any assumptions it made, with a clear undo option. The original user message, AI action, validation result, and final database change belong in the edit and debug logs.

If the AI service is unavailable or returns an invalid action, Nora must not modify inventory. It should tell the user that chat-based inventory updates are temporarily unavailable and record the diagnostic failure safely in the debug log.

## Early Feature Ideas

- **Chat Inventory Updates**: Add, remove, or update fridge items using plain language.
- **AI-First Text-to-Inventory**: Interpret every inventory message with ChatGPT, make best-effort assumptions for vague language, then show what Nora recorded and offer undo.
- **Current Fridge List**: Show what is currently in the fridge, grouped by category.
- **Human-Readable Inventory View**: Show a clean web view of the full inventory, organized by location and category, with the same details held in the database.
- **Expiration Tracking**: Track estimated or user-provided expiration dates.
- **Good-Faith Expiration Guessing**: Accept rough expiration language and store a best-effort expiration date or date range.
- **Leftover Tracking**: Track prepared or opened food separately and let ChatGPT estimate its usable window. Show both a conservative food-safety estimate and a broader, clearly labeled outer estimate for users who accept more uncertainty; neither is a guarantee that food is safe to eat.
- **Definitely Expired Alerts**: Proactively flag items that are clearly beyond their known or estimated storage window, such as six-month-old milk or two-month-old peeled garlic. Show why the item was flagged and let the user confirm it was discarded, update its details, or keep it.
- **Expired-Item Exclusion**: Never treat expired items as usable ingredients or include them in meal and recipe recommendations.
- **Low/Empty Detection**: Mark items as low, empty, or used up from chat messages.
- **Duplicate Prevention**: Warn when the user may already have something before adding it to a shopping list.
- **Requested Shopping Recommendations**: When asked, identify frequently replenished items from past activity and suggest likely staples to buy, such as full-fat milk the household regularly keeps in stock.
- **ChatGPT-Powered Meal Ideas**: Pass the user's question and relevant current or past inventory context to ChatGPT for open-ended help, such as 30-minute dinner ideas, recipes, substitutions, and ways to use items that will expire soon.
- **Use-Soon View**: Highlight food that should be eaten soon.
- **Shopping List**: Generate a list from missing staples, planned meals, or chat requests.
- **Quick Corrections**: Let the user fix mistakes conversationally, like "Actually, make that almond milk."
- **Inventory History**: Keep a simple log of what was added, used, expired, or removed.
- **Inventory Edit Log**: Record every inventory change with the time, affected item, action, previous value, new value, and source. This supports review and undo.
- **Debug Log**: Keep a separate diagnostic log of messages, parsed intent, assumptions, errors, and system events so unexpected behavior can be investigated without mixing it into the household inventory history.

## Possible Chat Commands

These do not need to be rigid commands, but they help define what the assistant should understand:

- Add item
- Remove item
- Update quantity
- Update expiration date
- Add a rough or approximate expiration estimate
- Add or update a leftover, including an AI-estimated usable window
- Check whether an item exists
- List everything in the fridge
- List items expiring soon
- List items that appear definitely expired
- Suggest meals
- Ask for AI cooking help, recipes, substitutions, or meal plans
- Ask what regular staples may need to be bought
- Create shopping list
- Undo last change

## MVP Scope

The first useful version could be very small:

1. A minimal single-screen interface: a chat window, an image-upload button that attaches a photo to a chat message, and the current fridge inventory list below.
2. A visible fridge inventory panel.
3. A neatly arranged web inventory view backed directly by the database.
4. Ability to add items from chat.
5. Ability to remove or mark items used from chat.
6. Basic item fields: name, quantity, unit, category, location, added date, expiration date.
7. Expiration date source and precision fields, with manual or image-read dates taking priority over AI estimates.
8. Local-only persistence so the inventory does not disappear on refresh; no accounts or cloud sync in the first version.
9. Persistent inventory edit log and debug log.
10. SQLite-backed relational storage, with a schema designed to remain compatible with other SQL databases later.
11. AI-powered chat responses for meal ideas and recipes, using inventory context without automatically changing inventory.
12. Clear alerts for items that appear definitely expired, without automatically removing them from inventory.
13. On-request shopping recommendations based on past inventory activity, without automatically changing the shopping list.
14. ChatGPT-powered text-to-inventory actions with structured validation, transaction-safe database writes, visible assumptions, and undo.
15. Current date, time, and household time-zone awareness for relative-date and expiration calculations.
16. Leftover tracking with AI-estimated conservative and explicitly uncertain broader expiration windows.
17. Prioritize fast inventory entry over meal suggestions in the first version.

## Nice Later Ideas

- Barcode scanning.
- Receipt scanning.
- Picture-based inventory add: take a photo of groceries, fridge contents, pantry shelves, or a receipt-like spread; use the ChatGPT API to identify items and propose additions for confirmation.
- Recipe integrations.
- Automatic expiration estimates by food type.

## Not Planned Yet

- In-fridge camera or photo-based fridge detection.
- Shared household inventory.
- Whole-home inventory views. The schema is ready for later expansion, but the interface remains fridge-only for now.
- Notifications before food expires. Nora should alert only after an item is definitely expired.
- Dietary preferences and allergy filters.
- Built-in weekly meal planning. Open-ended meal planning belongs to the ChatGPT agent.

## MVP Decisions

- **Scope**: The first interface tracks the fridge only. The data model remains ready for pantry, freezer, spices, and the rest of the house later.
- **Expiration dates**: Prefer a user-provided date, including a best-by date read from an uploaded image. Use an AI estimate only when no manual date is available.
- **Expiration display**: Always show an inferred calendar date, labeled **AI estimated** when Nora guessed it and **exact** when it came from user-provided or image-read information.
- **Interface**: Keep it minimal: chat window, image-upload button for attaching a photo to chat, and current fridge inventory beneath.
- **Storage**: Local only for now. No accounts or cloud sync in the MVP.
- **Priority**: Fast inventory entry comes before meal suggestions.
