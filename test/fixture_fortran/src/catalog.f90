module catalog
  implicit none

  type :: product_t
    character(len=64) :: name
    real :: price
    real :: tax_rate
  end type product_t

contains

  function find_product(name) result(product)
    character(len=*), intent(in) :: name
    type(product_t) :: product

    product%name = name
    product%price = 12.50
    product%tax_rate = 0.08
  end function find_product

end module catalog
