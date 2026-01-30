import protagonistiLuoghi from "./relazioni.json";
import protagonisti from "./protagonisti_relazioni.json";
import luoghi from "./protagonisti_luoghi_relazioni.json"; // oppure altro se in futuro separi

export type DatasetMode = "all" | "personaggi" | "luoghi";

export const DATASETS: Record<DatasetMode, Record<string, string[]>> = {
  all: protagonistiLuoghi,
  personaggi: protagonisti,
  luoghi: luoghi
};
