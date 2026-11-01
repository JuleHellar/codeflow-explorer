def load_customer(customer_id, include_history=False):
    customer = {
        "id": customer_id,
        "name": "Ada Lovelace",
        "email": "ada@example.com",
        "history": ["first order"] if include_history else [],
    }
    return customer


def update_contact(customer, email=None, phone=None):
    if email:
        customer["email"] = email
    if phone:
        customer["phone"] = phone
    return customer


def customer_label(customer):
    return f"{customer['name']} ({customer['id']})"
