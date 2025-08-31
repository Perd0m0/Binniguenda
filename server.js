// server.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
dotenv.config();

const app = express();

// --------- Config ----------
const LANDING = "https://binniguendahuatulco.bookinweb.es/es/booking/";
const TARGET_SEARCH = "https://binniguendahuatulco.bookinweb.es/es/booking/ajax/search/";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ScrapingBee: usa este endpoint oficial
const SCRAPINGBEE_ENDPOINT = "https://app.scrapingbee.com/api/v1/";
// (algunas guías usan https://api.scrapingbee.com/v1, ambos funcionan;
// si uno te diera problema, prueba el otro)

// Lee API key desde env
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY;
const useScraper = Boolean(SCRAPINGBEE_API_KEY);

function parseIntSafe(val, def = 0) {
  const n = parseInt(String(val ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : def;
}

function buildAllocations(adultos, ninos, edadesNinos) {
  const ages = Array(adultos).fill(30).concat(edadesNinos || []);
  return [{ ad: adultos, ch: ninos, ages }];
}

function buildTargetUrl(check_in, check_out, adultos, ninos, edadesNinos) {
  const allocations = buildAllocations(adultos, ninos, edadesNinos);
  const usp = new URLSearchParams({
    destination_id: "",
    hotel_codes: "HBH",
    date_from: check_in,
    date_to: check_out,
    allocations: JSON.stringify(allocations),
    sorting: "PRICE_ASC",
    reset: "false",
    force_room: "",
    promo_code: "",
    get_standard_rates: "1",
  });
  return `${TARGET_SEARCH}?${usp.toString()}`;
}

function nightsBetween(check_in, check_out) {
  const inD = new Date(check_in);
  const outD = new Date(check_out);
  const diff = (outD - inD) / (1000 * 60 * 60 * 24);
  return Math.floor(diff);
}

// --------- Core fetch ----------
async function fetchSearchHtml(targetUrl) {
  const headers = {
    "User-Agent": UA,
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "X-Requested-With": "XMLHttpRequest",
    Referer: LANDING,
  };

  // IMPORTANTE: pasar la URL "cruda"; axios se encarga del encoding
  const urlParam = targetUrl;

  if (useScraper) {
    try {
      const { data } = await axios.get(SCRAPINGBEE_ENDPOINT, {
        params: {
          api_key: SCRAPINGBEE_API_KEY,
          url: urlParam,
          // Opciones útiles
          render_js: "false",
          premium_proxy: "true",
          // forward_headers incluye nuestros headers al sitio objetivo
          forward_headers: "true",
        },
        headers,
        timeout: 30000,
        validateStatus: () => true, // queremos capturar cuerpo en 4xx/5xx
      });

      // Si la API respondió error, propágalo con detalle
      if (typeof data === "object" && data && (data.status || data.error)) {
        const status = data.status || 500;
        const msg = data.error || data.message || JSON.stringify(data).slice(0, 300);
        throw new Error(`Scraper error ${status}: ${msg}`);
      }
      // Algunos errores vienen con status HTTP
      if (typeof data === "string") {
        return data;
      }
      // Si no es string, devuelve stringificado
      return String(data);
    } catch (e) {
      // Axios error con response: muestra status y cuerpo
      if (e.response) {
        const body =
          typeof e.response.data === "string"
            ? e.response.data.slice(0, 500)
            : JSON.stringify(e.response.data).slice(0, 500);
        throw new Error(`Scraper HTTP ${e.response.status}: ${body}`);
      }
      throw e;
    }
  } else {
    // Petición directa (funcionará en tu PC; en Koyeb puede devolver vacío)
    const { data } = await axios.get(urlParam, {
      headers,
      timeout: 30000,
    });
    return data;
  }
}

function parseRooms(html, noches) {
  const $ = cheerio.load(html);
  const rooms = $(".room");
  const results = [];

  rooms.each((_, el) => {
    const nameTag =
      $(el).find(".room-header-name h2").first().text().trim() ||
      $(el).find(".room-header-name h3").first().text().trim();
    const room_name = nameTag || "N/A";

    const priceAttr =
      $(el).find(".rates .line[data-amount]").attr("data-amount") ||
      $(el).find("[data-amount]").attr("data-amount");

    let room_price_total = "N/A";
    let precio_por_noche = "N/A";
    if (priceAttr) {
      const val = parseFloat(String(priceAttr).replace(",", "."));
      if (!Number.isNaN(val) && noches > 0) {
        room_price_total = val;
        precio_por_noche = Math.round((val / noches) * 100) / 100;
      }
    }

    const availableText =
      $(el).find(".rates .remaining_rooms span").first().text().trim() ||
      $(el).find(".remaining_rooms span").first().text().trim() ||
      $(el).find(".availability .remaining span").first().text().trim() ||
      "0";

    const count = parseInt(availableText.replace(/[^\d]/g, ""), 10);
    if (Number.isFinite(count) && count > 0) {
      results.push({
        habitacion: room_name,
        precio_total: room_price_total,
        precio_por_noche,
        disponibles: String(count),
      });
    }
  });

  return results;
}

// --------- Rutas ----------
app.get("/health", (_, res) => res.json({ ok: true, useScraper, endpoint: SCRAPINGBEE_ENDPOINT }));

app.get("/consultar", async (req, res) => {
  try {
    const check_in = String(req.query.check_in || "");
    const check_out = String(req.query.check_out || "");
    const adultos = parseIntSafe(req.query.adultos, 2);
    const ninos = parseIntSafe(req.query.ninos, 0);
    const edades_raw = String(req.query.edades_ninos || "");
    const edades_ninos = (edades_raw.match(/\d+/g) || []).map((x) => parseInt(x, 10));

    if (!check_in || !check_out) {
      return res.status(400).json({ error: "Parámetros requeridos: check_in y check_out (YYYY-MM-DD)" });
    }

    const noches = nightsBetween(check_in, check_out);
    if (!(noches > 0)) {
      return res.status(400).json({ error: "La fecha de salida debe ser posterior a la fecha de entrada" });
    }

    const targetUrl = buildTargetUrl(check_in, check_out, adultos, ninos, edades_ninos);
    const html = await fetchSearchHtml(targetUrl); // << sin encodeURI

    const habitaciones = parseRooms(html, noches);

    const agesParam = [...Array(adultos).fill(30), ...edades_ninos].join(",");
    const link_busqueda =
      `https://binniguendahuatulco.bookinweb.es/es/booking/process/room?` +
      `date_from=${check_in}&date_to=${check_out}&ad=${adultos}&ch=${ninos}&ages=${agesParam}`;

    res.json({ habitaciones, link_busqueda });
  } catch (err) {
    // Muestra detalle del error del scraper si existe
    res.status(502).json({
      error: String(err?.message || err),
      hint: useScraper ? "Revisa SCRAPINGBEE_API_KEY y saldo/plan en ScrapingBee." : "Sin API de scraper: en Koyeb puede devolver vacío.",
    });
  }
});

app.get("/debug", async (req, res) => {
  try {
    const check_in = req.query.check_in || "2025-09-23";
    const check_out = req.query.check_out || "2025-09-25";
    const adultos = parseIntSafe(req.query.adultos, 2);
    const ninos = parseIntSafe(req.query.ninos, 0);
    const noches = nightsBetween(check_in, check_out);

    const targetUrl = buildTargetUrl(check_in, check_out, adultos, ninos, []);
    const html = await fetchSearchHtml(targetUrl);
    const habitaciones = parseRooms(html, noches);

    res.json({
      useScraper,
      endpoint: SCRAPINGBEE_ENDPOINT,
      rooms_found: habitaciones.length,
      preview: String(html).slice(0, 600),
    });
  } catch (e) {
    const status = e?.response?.status;
    const body =
      e?.response?.data
        ? typeof e.response.data === "string"
          ? e.response.data.slice(0, 500)
          : JSON.stringify(e.response.data).slice(0, 500)
        : undefined;
    res.status(500).json({ error: String(e?.message || e), status, body });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server on http://0.0.0.0:${PORT} (useScraper=${useScraper})`);
});
