STOCK = {"notebook": 18, "pen": 7}


def available_quantity(sku):
    return STOCK.get(sku, 0)


def reserve_stock(sku, quantity):
    available = available_quantity(sku)
    if quantity > available:
        return {"reserved": False, "available": available}
    STOCK[sku] = available - quantity
    return {"reserved": True, "remaining": STOCK[sku]}
