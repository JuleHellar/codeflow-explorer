from pkg.customer import customer_label


def render_receipt(customer, invoice, currency="$"):
    label = customer_label(customer)
    total = format_currency(invoice["total"], currency)
    lines = [
        f"Receipt for {label}",
        f"{invoice['quantity']} x {invoice['product']}",
        f"Total: {total}",
    ]
    return "\n".join(lines)


def format_currency(amount, symbol="$"):
    return f"{symbol}{amount:,.2f}"


def send_receipt(email, receipt, dry_run=True):
    if dry_run:
        return {"sent": False, "recipient": email, "preview": receipt}
    return {"sent": True, "recipient": email}
