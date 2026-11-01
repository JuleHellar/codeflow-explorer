def discount_for_customer(customer, subtotal):
    rate = discount_rate(customer)
    discount = subtotal * rate
    return round(discount, 2)


def discount_rate(customer):
    if customer.get("history"):
        return 0.1
    return 0.0
