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

  const urlParam = targetUrl;

  if (useScraper) {
    try {
      const { data } = await axios.get(SCRAPINGBEE_ENDPOINT, {
        params: {
          api_key: SCRAPINGBEE_API_KEY,
          url: urlParam,
          render_js: "false",
          premium_proxy: "true",
          forward_headers: "true",
        },
        headers,
        timeout: 30000,
        validateStatus: () => true,
      });

      if (typeof data === "object" && data && (data.status || data.error)) {
        const status = data.status || 500;
        const msg = data.error || data.message || JSON.stringify(data).slice(0, 300);
        throw new Error(`Scraper error ${status}: ${msg}`);
      }
      if (typeof data === "string") {
        return data;
      }
      return String(data);
    } catch (e) {
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
    const { data } = await axios.get(urlParam, {
      headers,
      timeout: 30000,
    });
    return data;
  }
}

// --------- Parsing ----------
function parseRooms(html, noches) {
  const $ = cheerio.load(html);
  const rooms = $(".room");
  const results = [];

  rooms.each((_, el) => {
    const nameTag =
      $(el).find(".room-header-name h2").first().text().trim() ||
      $(el).find(".room-header-name h3").first().text().trim();
    const room_name = nameTag || "N/A";

    // Intentar obtener el "tipo" o nombre de la tarifa si existe
    const tipo =
      $(el).find(".rates .line .rate-name").first().text().trim() ||
      $(el).find(".rates .line .name").first().text().trim() ||
      $(el).find(".rate .name").first().text().trim() ||
      $(el).find(".board_name, .board, .rate_title").first().text().trim() ||
      "";

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
        tipo: tipo || undefined,
        precio_total: room_price_total,
        precio_por_noche,
        disponibles: String(count),
      });
    }
  });

  return results;
}

// --------- Helpers de formateo ----------
function formatCurrencyMXN(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "N/A";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(n);
}

function buildContentString(habitaciones) {
  const lines = ["Productos:"];
  if (!Array.isArray(habitaciones) || habitaciones.length === 0) {
    lines.push("Sin disponibilidad.");
    return lines.join("\n");
  }

  habitaciones.forEach((h, i) => {
    const total = formatCurrencyMXN(h.precio_total);
    const porNoche = formatCurrencyMXN(h.precio_por_noche);
    const tipoTxt = h.tipo ? ` | Tipo: ${h.tipo}` : "";
    const dispTxt = h.disponibles ? ` | ${h.disponibles} disp.` : "";
    lines.push(
      `${i + 1}. ${h.habitacion}${tipoTxt}${dispTxt} | Total: ${total} | Por noche: ${porNoche}`
    );
  });

  return lines.join("\n");
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
      return res.status(400).json({
        messages: [
          {
            type: "to_user",
            content: 'Productos:\nError: Parámetros requeridos: check_in y check_out (YYYY-MM-DD)',
          },
        ],
      });
    }

    const noches = nightsBetween(check_in, check_out);
    if (!(noches > 0)) {
      return res.status(400).json({
        messages: [
          {
            type: "to_user",
            content: "Productos:\nError: La fecha de salida debe ser posterior a la fecha de entrada",
          },
        ],
      });
    }

    const targetUrl = buildTargetUrl(check_in, check_out, adultos, ninos, edades_ninos);
    const html = await fetchSearchHtml(targetUrl);

    const habitaciones = parseRooms(html, noches);

    // Construir el JSON EXACTO solicitado
    const content = buildContentString(habitaciones);
    return res.json({
      messages: [
        {
          type: "to_user",
          content,
        },
      ],
    });
  } catch (err) {
    return res.status(502).json({
      messages: [
        {
          type: "to_user",
          content:
            "Productos:\nError al consultar disponibilidad.\n" +
            String(err?.message || err) +
            (useScraper
              ? "\nHint: Revisa SCRAPINGBEE_API_KEY y saldo/plan en ScrapingBee."
              : "\nHint: Sin API de scraper: en Koyeb puede devolver vacío."),
        },
      ],
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
