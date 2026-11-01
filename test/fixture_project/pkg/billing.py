from pkg.promotions import discount_for_customer
from pkg.tax import calculate_tax


def calculate_total(customer):
    total = customer["id"] + 5
    return total


def create_invoice(customer, product, quantity=1):
    subtotal = product["price"] * quantity
    discount = discount_for_customer(customer, subtotal)
    taxable_amount = subtotal - discount
    tax = calculate_tax(taxable_amount, product["tax_rate"])
    total = taxable_amount + tax
    return {
        "customer_id": customer["id"],
        "product": product["name"],
        "quantity": quantity,
        "subtotal": subtotal,
        "discount": discount,
        "tax": tax,
        "total": total,
    }


class Invoice:
    def __init__(self, amount):
        self.amount = amount

    def gross(self, rate):
        result = self.amount * (1 + rate)
        return result
