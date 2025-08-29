from flask import Flask, request, jsonify
from datetime import datetime
import requests
from bs4 import BeautifulSoup
import json

app = Flask(__name__)

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

    # Usaremos la URL AJAX directamente
    search_url = "https://binniguendahuatulco.bookinweb.es/es/booking/ajax/search/"
    allocations = [{"ad": adultos, "ch": ninos, "ages": [30]*adultos + edades_ninos}]

    # Generar headers con User-Agent
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://binniguendahuatulco.bookinweb.es/es/booking/"
    }

    # Hacer GET a la URL AJAX
    params = {
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

    res = requests.get(search_url, headers=headers, params=params)
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
        f"https://binniguendahuatulco.bookinweb.es/es/booking/process/room?"
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
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    # Puerto 8000 para pruebas locales
    app.run(host="0.0.0.0", port=8000, debug=True)
