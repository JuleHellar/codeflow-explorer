def calculate_tax(amount, rate):
    tax = amount * rate
    return round(tax, 2)


def split_tax(amount, rate, jurisdictions):
    total_tax = calculate_tax(amount, rate)
    shares = {name: total_tax / len(jurisdictions) for name in jurisdictions}
    return shares
