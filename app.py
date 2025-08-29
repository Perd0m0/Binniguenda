from flask import Flask, request
import requests
from bs4 import BeautifulSoup
import json
from datetime import datetime

app = Flask(__name__)

def buscar_habitaciones(check_in, check_out, adultos=2, ninos=0, edades_ninos=None):
    if edades_ninos is None:
        edades_ninos = []

    fmt = "%Y-%m-%d"
    check_in_date = datetime.strptime(check_in, fmt)
    check_out_date = datetime.strptime(check_out, fmt)
    noches = (check_out_date - check_in_date).days
    if noches <= 0:
        raise ValueError("La fecha de salida debe ser posterior a la fecha de entrada")

    # Sesión HTTP
    session = requests.Session()
    url_base = "https://binniguendahuatulco.bookinweb.es/es/booking/"
    headers = {"User-Agent": "Mozilla/5.0"}

    # Obtener CSRF token
    res_main = session.get(url_base, headers=headers)
    csrf_token = None
    for cookie in session.cookies:
        if cookie.name in ["csrftoken", "csrfmiddlewaretoken"]:
            csrf_token = cookie.value
            break
    if not csrf_token:
        raise Exception("No se pudo obtener el token CSRF")

    # Parámetros AJAX
    allocations = [{"ad": adultos, "ch": ninos, "ages": [30]*adultos + edades_ninos}]
    search_url = url_base + "ajax/search/"
    params = {
        "csrfmiddlewaretoken": csrf_token,
        "destination_id": "",
        "hotel_codes": "HBH",
        "date_from": check_in,
        "date_to": check_out,
        "allocations": json.dumps(allocations),
        "sorting": "PRICE_ASC",
        "reset": "false",
        "force_room": "",
        "promo_code": "",
        "get_standard_rates": "1"
    }

    res = session.get(search_url, params=params, headers=headers)
    soup = BeautifulSoup(res.text, "html.parser")

    # Extraer habitaciones disponibles
    results = []
    rooms = soup.select(".room")
    for r in rooms:
        name_tag = r.select_one(".room-header-name h2")
        room_name = name_tag.text.strip() if name_tag else "N/A"

        price_tag = r.select_one(".rates .line[data-amount]")
        room_price_total = "N/A"
        precio_por_noche = "N/A"
        if price_tag and price_tag.has_attr("data-amount"):
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

    return results

# Endpoint HTTP para WhatsApp
@app.route("/consultar_habitaciones", methods=["GET"])
def consultar_habitaciones():
    check_in = request.args.get("check_in")
    check_out = request.args.get("check_out")
    adultos = int(request.args.get("adultos", 2))
    ninos = int(request.args.get("ninos", 0))
    edades_ninos = request.args.get("edades_ninos", "")

    if edades_ninos:
        edades_ninos = [int(x) for x in edades_ninos.split(",")]
    else:
        edades_ninos = []

    try:
        habitaciones = buscar_habitaciones(check_in, check_out, adultos, ninos, edades_ninos)
        if not habitaciones:
            return "⚠️ No hay habitaciones disponibles."

        mensaje = f"Disponibilidad de habitaciones del {check_in} al {check_out}:\n\n"
        for h in habitaciones:
            mensaje += (f"- {h['habitacion']}: Total {h['precio_total']}€ | "
                        f"Por noche {h['precio_por_noche']}€ | "
                        f"Disponibles: {h['disponibles']}\n")
        return mensaje
    except Exception as e:
        return f"⚠️ Error: {str(e)}"

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
