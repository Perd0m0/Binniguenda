from flask import Flask, request, jsonify
from playwright.sync_api import sync_playwright
from datetime import datetime

app = Flask(__name__)

def buscar_habitaciones(check_in, check_out, adultos=2, ninos=0):
    """Consulta las habitaciones disponibles y precios usando Playwright headless"""
    fmt = "%Y-%m-%d"
    check_in_date = datetime.strptime(check_in, fmt)
    check_out_date = datetime.strptime(check_out, fmt)
    noches = (check_out_date - check_in_date).days
    if noches <= 0:
        raise ValueError("La fecha de salida debe ser posterior a la fecha de entrada")

    resultados = []
    link_busqueda = ""

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("https://binniguendahuatulco.bookinweb.es/es/booking/")
        
        # Preparamos el script para hacer la búsqueda AJAX
        allocations = [{"ad": adultos, "ch": ninos, "ages": [30]*adultos}]
        csrf_token = page.evaluate("document.querySelector('input[name=csrfmiddlewaretoken]').value")
        
        params = {
            "csrfmiddlewaretoken": csrf_token,
            "destination_id": "",
            "hotel_codes": "HBH",
            "date_from": check_in,
            "date_to": check_out,
            "allocations": str(allocations).replace("'", '"'),
            "sorting": "PRICE_ASC",
            "reset": "false",
            "force_room": "",
            "promo_code": "",
            "get_standard_rates": "1"
        }

        query_string = "&".join([f"{k}={v}" for k, v in params.items()])
        search_url = f"https://binniguendahuatulco.bookinweb.es/es/booking/ajax/search/?{query_string}"
        page.goto(search_url)
        page.wait_for_timeout(2000)

        rooms = page.query_selector_all(".room")
        for r in rooms:
            name_el = r.query_selector(".room-header-name h2")
            room_name = name_el.inner_text().strip() if name_el else "N/A"

            price_el = r.query_selector(".rates .line[data-amount]")
            room_price_total = "N/A"
            precio_por_noche = "N/A"
            if price_el:
                try:
                    room_price_total = float(price_el.get_attribute("data-amount").replace(',', '.'))
                    precio_por_noche = round(room_price_total / noches, 2)
                except:
                    room_price_total = "N/A"
                    precio_por_noche = "N/A"

            avail_el = r.query_selector(".rates .remaining_rooms span")
            disponibles = avail_el.inner_text().strip() if avail_el else "0"

            if disponibles != "0":
                resultados.append({
                    "habitacion": room_name,
                    "precio_total": room_price_total,
                    "precio_por_noche": precio_por_noche,
                    "disponibles": disponibles
                })

        link_busqueda = (
            f"https://binniguendahuatulco.bookinweb.es/es/booking/process/room?"
            f"date_from={check_in}&date_to={check_out}&ad={adultos}&ch={ninos}"
        )

        browser.close()
    return resultados, link_busqueda

@app.route('/')
def home():
    return "🏨 API de consulta de habitaciones Binniguenda funcionando."

@app.route('/consultar', methods=['GET'])
def consultar():
    try:
        check_in = request.args.get("check_in")
        check_out = request.args.get("check_out")
        adultos = int(request.args.get("adultos", 2))
        ninos = int(request.args.get("ninos", 0))

        habitaciones, link = buscar_habitaciones(check_in, check_out, adultos, ninos)
        return jsonify({
            "habitaciones": habitaciones,
            "link_busqueda": link
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    # Render usa la variable de entorno PORT
    import os
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port)
