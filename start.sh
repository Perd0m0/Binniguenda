#!/bin/bash
export FLASK_APP=app_requests.py
flask run --host=0.0.0.0 --port=$PORT
