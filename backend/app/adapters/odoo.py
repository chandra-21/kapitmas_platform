"""
Odoo integration adapter.
Saat ini mengembalikan None (fallback ke internal DB).
Implementasi aktif ketika Odoo REST API sudah siap.
"""
from app.core.logging import get_logger
from typing import Optional

logger = get_logger(__name__)


class OdooAdapter:

    async def get_locations(self) -> Optional[list[dict]]:
        """
        TODO: GET {odoo_url}/api/v2/stock.warehouse atau location endpoint.
        Return format: [{"odoo_id": 1, "name": "Lantai 1"}, ...]
        Return None → service akan fallback ke internal DB.
        """
        return None

    async def get_asset_units(
        self, location_odoo_id: int | None = None, type: str | None = None
    ) -> Optional[list[dict]]:
        """
        TODO: GET {odoo_url}/api/v2/stock.lot atau asset unit endpoint.
        Return format: [{"odoo_id": 10, "unit_id": "KapitMas/Scales/0021", "name": "Timbangan Ke-21", "type": "timbangan", "location_odoo_id": 1}, ...]
        Return None → service akan fallback ke internal DB.
        """
        return None


odoo_adapter = OdooAdapter()
