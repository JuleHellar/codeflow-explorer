from pkg.inventory import available_quantity


PRODUCTS = {
    "notebook": {"name": "Engineering notebook", "price": 12.5, "tax_rate": 0.08},
    "pen": {"name": "Fountain pen", "price": 24.0, "tax_rate": 0.08},
}


def find_product(sku):
    product = PRODUCTS.get(sku)
    if product is None:
        return None
    stock = available_quantity(sku)
    return {**product, "sku": sku, "stock": stock}


def search_products(query, max_price=None):
    matches = [
        {**product, "sku": sku}
        for sku, product in PRODUCTS.items()
        if query.lower() in product["name"].lower()
        and (max_price is None or product["price"] <= max_price)
    ]
    return matches
