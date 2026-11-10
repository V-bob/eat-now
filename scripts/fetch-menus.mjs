// Downloads the next week of dining hall and campus market menus from
// University Housing and saves one JSON file per day in public/menus/.
//
// The browser can't call the Housing API directly (it only answers its own
// website), so we copy the menus into the app ahead of time.
//
// Run with: npm run fetch-menus

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";

const API_URL = "https://web.housing.illinois.edu/DiningMenus/api/DiningMenu/GetOption/";
const OUTPUT_DIR = new URL("../public/menus/", import.meta.url);
const DAYS_AHEAD = 7;

// Housing's DiningOptionID for each place id in src/places.ts.
const DINING_OPTION_IDS = {
  ikenberry: 1,
  par: 2,
  isr: 3,
  lar: 5,
  "57-north": 7,
  terrabyte: 18,
};

function localDateString(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// Every tag Housing used as of 2026-11-09. The diet filters in src/diets.ts match some of these
// names exactly, so a renamed tag (say "Milk" becoming "Dairy") would quietly let dishes through a
// filter. Tags not on this list are reported so someone can check src/diets.ts before trusting them.
const KNOWN_TAGS = new Set([
  "Alcohol", "Coconut", "Corn", "Eggs", "Fish", "Gelatin", "Gluten", "Halal", "Jain", "Kosher",
  "Milk", "MSG", "Peanuts", "Pork", "Red Dye", "Sesame", "Shellfish", "Soy", "Sulfites",
  "Sustainable Seafood", "Tree Nuts", "Vegan", "Vegetarian", "Wheat",
]);

function unknownTags(items) {
  return items.flatMap((item) => item.traits).filter((tag) => !KNOWN_TAGS.has(tag));
}

async function fetchMenu(diningOptionId, date) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ DiningOptionID: String(diningOptionId), mealDate: date }),
  });
  if (!response.ok) {
    throw new Error(`Housing API returned ${response.status} for option ${diningOptionId} on ${date}`);
  }
  const rows = await response.json();
  return rows.map((row) => ({
    meal: row.Meal,
    station: row.ServingUnit,
    course: row.Course,
    name: row.FormalName,
    traits: (row.Traits ?? "")
      .split(",")
      .map((trait) => trait.trim())
      .filter((trait) => trait.length > 0),
  }));
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  for (const file of await readdir(OUTPUT_DIR)) {
    if (file.endsWith(".json")) {
      await rm(new URL(file, OUTPUT_DIR));
    }
  }

  const unknown = new Set();
  const today = new Date();
  for (let offset = 0; offset < DAYS_AHEAD; offset++) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    const date = localDateString(day);
    const menus = {};
    for (const [placeId, optionId] of Object.entries(DINING_OPTION_IDS)) {
      menus[placeId] = await fetchMenu(optionId, date);
    }
    const itemCount = Object.values(menus).reduce((sum, items) => sum + items.length, 0);
    unknownTags(Object.values(menus).flat()).forEach((tag) => unknown.add(tag));
    await writeFile(
      new URL(`${date}.json`, OUTPUT_DIR),
      JSON.stringify({ date, fetchedAt: new Date().toISOString(), menus }),
    );
    console.log(`${date}: ${itemCount} menu items`);
  }
  if (unknown.size > 0) {
    console.warn(
      `New menu tags from Housing: ${[...unknown].join(", ")}. Check that the diet filters in src/diets.ts ` +
        "still match Housing's tags, then add these to KNOWN_TAGS in scripts/fetch-menus.mjs.",
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
