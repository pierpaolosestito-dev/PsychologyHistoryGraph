export interface PersonDetails {
  tipo: "person";
  nome: string;
  luogo_nascita?: string;
  anno_nascita?: number;
  anno_morte?: number;
  periodo?: string;
  biografia_html?: string;
}

export interface PlaceDetails {
  tipo: "place";
  titolo: string;
  immagine_url?: string;
  contenuto?: string;
  citta?: string;
  latitudine?: number;
  longitudine?: number;
}

export type NodeDetails = PersonDetails | PlaceDetails;

export const personDetailsMap = new Map<string, PersonDetails>();
export const placeDetailsMap = new Map<string, PlaceDetails>();

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;

    const cols: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"' && line[i - 1] !== "\\") {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        cols.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    cols.push(current.trim());
    rows.push(cols.map(c => c.replace(/^"|"$/g, "")));
  }

  return rows;
}

export async function loadDetails() {
  await loadPersonsCSV();
  await loadPlacesCSV();
}

async function loadPersonsCSV() {
  const res = await fetch("protagonisti_con_periodo.csv");
  const text = await res.text();
  const rows = parseCSV(text);

  const header = rows[0];
  const dataRows = rows.slice(1);

  for (const row of dataRows) {
    const obj: any = {};
    header.forEach((h, i) => (obj[h] = row[i]));

    const nome = obj["nome"]?.trim();
    if (!nome) continue;
    const nomeN = nome.trim().replace(/\s+/g, " ");
    personDetailsMap.set(nomeN, {
      tipo: "person",
      nome,
      luogo_nascita: obj["luogo_nascita"],
      anno_nascita: Number(obj["anno_nascita"]),
      anno_morte: Number(obj["anno_morte"]),
      periodo: obj["periodo"],
      biografia_html: obj["biografia_html"]
    });
  }

  console.log("Loaded persons:", personDetailsMap.size);
}

async function loadPlacesCSV() {
  const res = await fetch("luoghi.csv");
  const text = await res.text();
  const rows = parseCSV(text);

  const header = rows[0];
  const dataRows = rows.slice(1);

  for (const row of dataRows) {
    const obj: any = {};
    header.forEach((h, i) => (obj[h] = row[i]));

    const titolo = obj["titolo"]?.trim();
    if (!titolo) continue;
    const titoloN = titolo.trim().replace(/\s+/g, " ");
    placeDetailsMap.set(titoloN, {
      tipo: "place",
      titolo,
      immagine_url: obj["immagine_url"],
      contenuto: obj["contenuto"],
      citta: obj["citta"],
      latitudine: Number(obj["latitudine"]),
      longitudine: Number(obj["longitudine"])
    });
  }

  console.log("Loaded places:", placeDetailsMap.size);
}