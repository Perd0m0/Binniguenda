from flask import Flask, request, jsonify
from datetime import datetime
import requests
from requests.adapters import HTTPAdapter, Retry
from bs4 import BeautifulSoup
import json

app = Flask(__name__)

# --- SESIÓN GLOBAL, REINTENTOS Y HEADERS ---
SESSION = requests.Session()
retries = Retry(
    total=3,
    backoff_factor=0.5,
    status_forcelist=(429, 500, 502, 503, 504),
    allowed_methods=frozenset(["GET", "POST"])
)
SESSION.mount("https://", HTTPAdapter(max_retries=retries))
SESSION.mount("http://", HTTPAdapter(max_retries=retries))

BASE = "https://binniguendahuatulco.bookinweb.es"
LANDING = f"{BASE}/es/booking/"
SEARCH_URL = f"{BASE}/es/booking/ajax/search/"

COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": LANDING,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "X-Requested-With": "XMLHttpRequest",
    # Si tu PaaS usa proxy, respeta variables de entorno:
    # requests ya respeta HTTPS_PROXY/HTTP_PROXY por defecto con trust_env=True
}
SESSION.trust_env = True  # respeta proxies/vars del entorno del PaaS

def warmup_session():
    """Visita la landing para que el sitio te ponga cookies/idioma
    antes de pegarle al endpoint AJAX directo.
    """
    try:
        SESSION.get(LANDING, headers=COMMON_HEADERS, timeout=20, allow_redirects=True)
    except Exception:
        # No hacemos raise aquí para no romper el flujo si el warmup falla
        pass

def buscar_habitaciones(check_in, check_out, adultos=2, ninos=0, edades_ninos=None):
    if edades_ninos is None:
        edades_ninos = []

    # Calcular noches
    fmt = "%Y-%m-%d"
    check_in_date = datetime.strptime(check_in, fmt)
    check_out_date = datetime.strptime(check_out, fmt)
    noches = (check_out_date - check_in_date).days
    if noches <= 0:
        raise ValueError("La fecha de salida debe ser posterior a la fecha de entrada")

    # Tu URL AJAX DIRECTA (sin cambios)
    search_url = SEARCH_URL
    allocations = [{"ad": adultos, "ch": ninos, "ages": [30]*adultos + edades_ninos}]

    # Calentar cookies/idioma antes del AJAX
    warmup_session()

    # Hacer GET a la URL AJAX (misma lógica que tenías)
    params = {
        "destination_id": "",
        "hotel_codes": "HBH",
        "date_from": check_in,
        "date_to": check_out,
        "allocations": json.dumps(allocations),  # sin separators para no tocar tu payload
        "sorting": "PRICE_ASC",
        "reset": "false",
        "force_room": "",
        "promo_code": "",
        "get_standard_rates": "1"
    }

    res = SESSION.get(search_url, headers=COMMON_HEADERS, params=params, timeout=25)
    res.raise_for_status()  # si algo sale mal, que explote arriba y lo capturamos en /consultar
    soup = BeautifulSoup(res.text, "html.parser")

    results = []
    rooms = soup.select(".room")
    for r in rooms:
        name_tag = r.select_one(".room-header-name h2")
        room_name = name_tag.text.strip() if name_tag else "N/A"

        price_tag = r.select_one(".rates .line[data-amount]")
        room_price_total = "N/A"
        precio_por_noche = "N/A"

        if price_tag and price_tag.has_attr('data-amount'):
            try:
                room_price_total = float(price_tag['data-amount'].replace(',', '.'))
                precio_por_noche = round(room_price_total / noches, 2)
            except:
                room_price_total = "N/A"
                precio_por_noche = "N/A"

        available_tag = r.select_one(".rates .remaining_rooms span")
        available_count = available_tag.text.strip() if available_tag else "0"

        try:
            if int(available_count) > 0:
                results.append({
                    "habitacion": room_name,
                    "precio_total": room_price_total,
                    "precio_por_noche": precio_por_noche,
                    "disponibles": available_count
                })
        except:
            continue

    link_busqueda = (
        f"{BASE}/es/booking/process/room?"
        f"date_from={check_in}&date_to={check_out}"
        f"&ad={adultos}&ch={ninos}"
        f"&ages={','.join([str(30)]*adultos + [str(a) for a in edades_ninos])}"
    )

    return results, link_busqueda

@app.route('/consultar', methods=['GET'])
def consultar():
    try:
        check_in = request.args.get("check_in")
        check_out = request.args.get("check_out")
        adultos_str = request.args.get("adultos", "2")
        ninos_str = request.args.get("ninos", "0")

        adultos = int(''.join(filter(str.isdigit, adultos_str)))
        ninos = int(''.join(filter(str.isdigit, ninos_str)))

        habitaciones, link_busqueda = buscar_habitaciones(check_in, check_out, adultos, ninos)

        return jsonify({
            "habitaciones": habitaciones,
            "link_busqueda": link_busqueda
        })
    except requests.HTTPError as http_err:
        status = http_err.response.status_code if http_err.response is not None else 502
        body = ""
        try:
            body = http_err.response.text[:200]
        except Exception:
            pass
        return jsonify({"error": f"HTTP {status}", "detalle": body}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port)

