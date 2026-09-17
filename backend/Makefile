.PHONY: dev prod install migrate migrate-create migrate-dev migrate-prod shell

install:
	pip install -r requirements.txt

dev:
	uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

prod:
	uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4

migrate:
	alembic upgrade head

migrate-create:
	alembic revision --autogenerate -m "$(msg)"

# Docker dev — jalankan dari root project (bukan folder backend)
migrate-dev:
	docker compose -f ../docker-compose.dev.yml run --rm migrate

# Docker prod — jalankan DI LUAR JAM OPERASIONAL
migrate-prod:
	docker compose -f ../docker-compose.prod.yml run --rm \
	  -e DATABASE_URL=$$(grep DATABASE_URL ../.env.prod | cut -d= -f2) \
	  backend alembic upgrade head

shell:
	python -c "from app.config import settings; print(settings)"
