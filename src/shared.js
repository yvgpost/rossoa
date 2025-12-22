let basket = JSON.parse(localStorage.getItem("basket")) || []; // Retrieve basket from local storage or initialize as an empty array

let calculation = () => {
  let cartIcon = document.getElementById("cartAmount");
  if (cartIcon) {
    let totalItems = basket.map((x) => x.item).reduce((x, y) => x + y, 0); // Sum up all item quantities
    cartIcon.innerHTML = totalItems > 0 ? totalItems : 0; // Display 0 if basket is empty
  }
};

// Call calculation on page load
document.addEventListener("DOMContentLoaded", () => {
  calculation();
});