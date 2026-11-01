from pkg.billing import create_invoice
from pkg.catalog import find_product
from pkg.customer import load_customer, update_contact
from pkg.reporting import render_receipt, send_receipt


def main():
    customer = load_customer(42)
    customer = update_contact(customer, email="ada@example.com")
    product = find_product("notebook")
    invoice = create_invoice(customer, product, quantity=2)
    receipt = render_receipt(customer, invoice)
    send_receipt(customer["email"], receipt)
    return receipt


main()
