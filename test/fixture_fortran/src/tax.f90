module tax
  implicit none

contains

  function calculate_tax(taxable_amount, rate) result(amount)
    real, intent(in) :: taxable_amount
    real, intent(in) :: rate
    real :: amount

    amount = taxable_amount * rate
  end function calculate_tax

end module tax
