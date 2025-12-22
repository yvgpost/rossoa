// Import or include all product data arrays
const shopItemsData = [...cleanData, ...desinfectionData, ...combData, ...careData, ...specData];

document.addEventListener("DOMContentLoaded", () => {
  // First, render the cart items based on the basket
  const basketData = fetchBasketData();
  updateCartList(basketData);

  // Then, check if the order form should be reopened
  const isOrderFormOpen = localStorage.getItem("orderFormOpen");

  // Only reopen the form if it was open before AND the basket is not empty
  if (isOrderFormOpen === "true" && basket.length > 0) {
    openOrderForm();
  } else {
    // Otherwise, ensure the flag is cleared if the basket is empty
    localStorage.removeItem("orderFormOpen");
  }
});

  const formatPrice = (priceInCents) => {
    const price = priceInCents / 100; // Convert cents to decimal
    return new Intl.NumberFormat("cs-CZ", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price) + " Kč";
  };

  let fetchBasketData = () => {
    if (!basket || basket.length === 0) {
      console.log("Basket is empty.");
      return []; // Return an empty array if the basket is empty
    }
  
    const basketData = basket.map((basketItem) => {
      const product = shopItemsData.find((item) => item.id === basketItem.id);
  
      if (!product) {
        console.warn(`Product with id ${basketItem.id} not found in shopItemsData.`);
        return null; // Handle missing product gracefully
      }
  
      return {
        ...product,
        quantity: basketItem.item,
        totalPrice: product.pricePerUnit * basketItem.item, // Total price in cents
      };
    });
  
    return basketData.filter((item) => item !== null); // Filter out null values
  };

  let updateCartList = (basketData) => {
    const cartContainer = document.getElementById("products-grid-cart");
    cartContainer.innerHTML = "";
  
    if (!basketData || basketData.length === 0) {
      cartContainer.innerHTML = `
      <div class="empty-cart">
        <p>Košík je prázdný</p>
        <img src="img/empty_cart.png">
      
      `; // "The cart is empty."
      return;
    }
  
    let list = document.createElement("div");
    list.classList.add("cart-item-container");
  
    let totalPriceWithoutVAT = 0;
    let totalPriceWithVAT = 0;
    let totalUnits = 0;
  
    basketData.forEach((product) => {
      let listItem = document.createElement("div");
      listItem.id = `cart-item-${product.id}`; 
      listItem.innerHTML = `
        <div class="cart-item">
          <div class="cart-item-details">
            <img src="${product.img}" alt="${product.productName}" class="cart-item-img">
            <p class="cart-item-name" style="background-color: ${product.categoryColor};" onclick="openProductPage(${product.id})">${product.productName}</p>
            <div class="cart-item-counter">
              <button class="decrement" onclick="decrement(${product.id})">-</button>
              <span class="counter">${product.quantity}</span>
              <button class="increment" onclick="increment(${product.id})">+</button>
            </div>
            <p class="cart-item-units">${product.amount * product.quantity} ${product.unit}</p>
            <p class="cart-item-total">${formatPrice(product.totalPrice)} (bes DPH)</p>
          </div>
        </div>
      `;
      list.appendChild(listItem);
  
      // Accumulate totals
      totalUnits += (product.amount * product.quantity);
      totalPriceWithoutVAT += product.totalPrice; 
      totalPriceWithVAT += product.totalPrice * 1.21; 
    });
  
    cartContainer.appendChild(list);
  
    // Update totals only on cart.html
    if (window.location.pathname.includes("cart.html")) {
      const deliveryCostCents = computeDeliveryCost(basketData);
      const totalPriceWithVATRounded = Math.round(totalPriceWithVAT);
      const totalToPayCents = totalPriceWithVATRounded + deliveryCostCents;
      
      const FREE_THRESHOLD_CENTS = 8000 * 100;
      const remainingToFreeCents = Math.max(0, FREE_THRESHOLD_CENTS - totalPriceWithoutVAT);
        const deliveryText = deliveryCostCents === 0
          ? `Doprava: ${formatPrice(0)}`
          : `Doprava: ${formatPrice(deliveryCostCents)}`;
      const totalsDiv = document.createElement("div");
      totalsDiv.className = "cart-totals";
      totalsDiv.innerHTML = `
        <div class="products-title">
          <p>Shrnutí objednávky</p>
        </div>
        <div class="totals">
        <div class="sums">
      <p class="total-without-vat">
        Celková cena (bes DPH): ${formatPrice(totalPriceWithoutVAT)}
        ${
          remainingToFreeCents > 0
            ? `<span class="delivery-inline">Pro dopravu zdarma nakupte ještě za <span class="delivery-inline-amount">${formatPrice(remainingToFreeCents)}</span></span>`
            : "" // No need for extra span if delivery is free
        }
      </p>          
<p class="total-with-vat">Celková cena (s DPH, 21 %): ${formatPrice(totalPriceWithVAT)}</p>
          <p class="delivery-cost">${deliveryText}</p>
          <p class="total-to-pay">Celkem k úhradě: ${formatPrice(totalToPayCents)}</p>
          <p class="delivery-terms">Obvykle odesíláme  objednávky zákazníkům do 7 dnů.<br>Informujeme vás, pokud výroba objednávky potrvá déle.<br> Přesné dodací lhůty budou uvedeny na faktuře.</p>
        </div>
        <div class="cart-totals-buttons">
          <button class="clear-cart-button" onclick="clearCart()">Vyprázdnit košík</button>
          <button class="open-order-form-button" onclick="openOrderForm()">Objednat</button>
        </div>
          </div>
      `;
      cartContainer.appendChild(totalsDiv);
    }
  };

  let clearCart = () => {
    closeOrderForm(); // Close the form and clear its state from localStorage
    basket = []; // Clear the basket
    localStorage.setItem("basket", JSON.stringify(basket)); // Save the empty basket to localStorage
    updateCartList(fetchBasketData()); // Refresh the cart list to show it's empty
    calculation(); // Update the basket counter
  };

  let increment = (id) => {
    const search = basket.find((x) => x.id === id);
  
    if (search) {
      search.item += 1; // Increment the quantity
    } else {
      basket.push({ id: id, item: 1 }); // Add the product to the basket if it doesn't exist
    }
  
    localStorage.setItem("basket", JSON.stringify(basket)); // Save the updated basket to localStorage
  
    // Update the specific cart item in the DOM
    const cartItem = document.getElementById(`cart-item-${id}`);
    if (cartItem) {
      const product = shopItemsData.find((x) => x.id === id);
      cartItem.querySelector(".counter").textContent = search.item; // Update the quantity
      cartItem.querySelector(".cart-item-units").textContent = `${product.amount * search.item} ${product.unit}`; // Update the total units
      cartItem.querySelector(".cart-item-total").textContent = `${formatPrice(product.pricePerUnit * search.item)} (bes DPH)`; // Update the total price
    }
  
    if (window.location.pathname.includes("cart.html")) {
      updateTotals(); // Update totals dynamically only on cart.html
    }
  
    calculation(); // Update the small cart counter
    updateOrderForm(); // Update only the order details
  };

  let decrement = (id) => {
    const search = basket.find((x) => x.id === id);
  
    if (!search) {
      console.warn(`Product with id ${id} not found in the basket.`);
      return;
    }
  
    const cartItem = document.getElementById(`cart-item-${id}`);
  
    if (search.item === 1) {
      basket = basket.filter((x) => x.id !== id);
      if (cartItem) {
        cartItem.remove();
      }
    } else {
      search.item -= 1;
      if (cartItem) {
        const product = shopItemsData.find((x) => x.id === id);
        cartItem.querySelector(".counter").textContent = search.item;
        cartItem.querySelector(".cart-item-units").textContent = `${product.amount * search.item} ${product.unit}`;
        cartItem.querySelector(".cart-item-total").textContent = `${formatPrice(product.pricePerUnit * search.item)} (bes DPH)`;
      }
    }
  
    if (window.location.pathname.includes("cart.html")) {
      updateTotals();
    }
  
    if (basket.length === 0) {
      clearCart();
    }
  
    calculation();
    localStorage.setItem("basket", JSON.stringify(basket));
    updateOrderForm(); // Update only the order details
  };

let openOrderForm = () => {
  const cartContainer = document.getElementById("products-grid-cart");
  const existingForm = document.getElementById("order-form");

  // Prevent multiple forms from being added
  if (existingForm) {
    alert("Objednávkový formulář je již otevřen."); // "The order form is already open."
    return;
  }


const orderForm = document.createElement("form");
orderForm.id = "order-form";
orderForm.className = "order-form";
orderForm.innerHTML = `
  <div class="products-title">
    <p>Údaje zákazníka</p>
  </div>
  <div class="input-fields">
    <div>
      <label for="name">Jméno<span style="color:#c13540">*</span></label>
      <input type="text" id="name" name="name" required />       
    </div>
    <div>
      <label for="surname">Příjmení<span style="color:#c13540">*</span></label>
      <input type="text" name="surname" required />
    </div>
    <div>
      <label for="phone">Telefon<span style="color:#c13540">*</span></label>   
      <input type="text" name="phone" placeholder="např. 111 222 333" maxlength="16" minlength="9" pattern="[0-9\\-\\+\\(\\)\\s]+" required />
    </div>
    <div>
      <label for="email">Email<span style="color:#c13540">*</span></label>   
      <input type="email" name="email" placeholder="např. mail@adress.com" required />
    </div>
    <div>
      <label for="deliveryAddress">Dodací adresa<span style="color:#c13540">*</span></label>   
      <input type="text" name="deliveryAddress" placeholder="Zadejte polohu" required />
    </div>
    <div>
      <label for="companyName">Název společnosti</label>
      <input type="text" name="companyName" />
    </div>
    <div>
      <label for="icNumber">IČO</label>   
      <input type="text" name="icNumber" />
    </div>
    <div>
      <label for="dicNumber">DIČ</label>   
      <input type="text" name="dicNumber" />
    </div>
    <div id="ordernotes">
      <label for="notes">Poznámky k objednávce</label>   
      <textarea id="ordernotesText" name="notes"></textarea>
    </div>
    <div class="souhlas-container">
      <input type="checkbox" name="checkbox" id="checkbox" required="">
      <label id="checkboxLabel" for="checkbox">
        <span id="souhlas">Souhlas se zpracováním <a href="gdpr.html" target="_blank" rel="noopener">osobních&nbsp;údajů</a> a <a href="terms.html" target="_blank" rel="noopener">obchodními&nbsp;podmínkami</a></span>
      </label>
    </div>
  </div> 
  <textarea class="order-text-area-details" name="orderDetails" readonly>${generateOrderDetails(fetchBasketData())}</textarea>
  <button class="send-order-button" type="button" onclick="submitOrder()">Odeslat objednávku</button>
`;

  cartContainer.appendChild(orderForm);

  // Restore saved form data from localStorage
  const savedData = JSON.parse(localStorage.getItem("orderFormData"));
  if (savedData) {
    Object.keys(savedData).forEach(key => {
      const field = orderForm.querySelector(`[name="${key}"]`);
      // --- Defensive check: DO NOT restore the orderDetails field ---
      if (field && key !== "orderDetails") {
        field.value = savedData[key];
      }
    });
  }

   // Add event listener to save form data on input
   orderForm.addEventListener("input", () => {
    const formData = new FormData(orderForm);
    const data = Object.fromEntries(formData.entries());
    // --- FIX: Do not save the generated order details ---
    delete data.orderDetails; 
    localStorage.setItem("orderFormData", JSON.stringify(data));
  });

  // Save the state of the order form in localStorage
  localStorage.setItem("orderFormOpen", "true");
};

let generateOrderDetails = (basketData) => {
  // Calculate totals from the basket data
  const totalPriceWithoutVAT = basketData.reduce((sum, product) => sum + product.totalPrice, 0);
  const totalPriceWithVAT = totalPriceWithoutVAT * 1.21; // Assuming 21% VAT

  // Generate the list of products
  const productLines = basketData
    .map(
      (product) =>
        `${product.productName} - Množství: ${product.quantity}, Cena za kus: ${formatPrice(
          product.pricePerUnit
        )}, Celkem: ${formatPrice(product.totalPrice)}`
    )
    .join("\n");

  // Combine product lines with the totals
  return `${productLines}\n\n----------------------------------\nCelková cena (bes DPH): ${formatPrice(
    totalPriceWithoutVAT
  )}\nCelková cena (s DPH, 21 %): ${formatPrice(totalPriceWithVAT)}`;
};

let submitOrder = async () => {
  const form = document.getElementById("order-form");
  if (!form) return;

  // Check required fields before submitting
  if (!form.checkValidity()) {
    alert("Vyplňte prosím všechna povinná pole."); // "Please fill in all required fields."
    form.reportValidity(); // Show browser validation messages
    return;
  }

  const formData = new FormData(form);

  try {
    const response = await fetch("src/send_order.php", {
      method: "POST",
      body: formData,
    });

    if (response.ok) {
      closeOrderForm();
      alert("Děkujeme za vaši objednávku!");
      // ...existing code...
    } else {
      alert("Došlo k chybě při odesílání objednávky.");
    }
  } catch (error) {
    console.error("Error submitting order:", error);
    alert("Došlo k chybě při odesílání objednávky.");
  }
};

  const computeDeliveryCost = (basketData) => {
    const totalPriceWithoutVAT = basketData.reduce((sum, p) => sum + p.totalPrice, 0);
    if (totalPriceWithoutVAT >= 8000 * 100) {
      return 0;
    }
    // Otherwise delivery = 50 Kč per unit
    const totalUnits = basketData.reduce((sum, p) => sum + (p.amount * p.quantity), 0);
    return totalUnits * 50 * 100; // cents
  };

  let updateTotals = () => {
    const basketData = fetchBasketData();
  
    const totalPriceWithoutVAT = basketData.reduce((sum, product) => sum + product.totalPrice, 0);
    const totalPriceWithVAT = totalPriceWithoutVAT * 1.21;

    // compute delivery and total-to-pay (in cents)
    const deliveryCostCents = computeDeliveryCost(basketData);
    const totalToPayCents = Math.round(totalPriceWithVAT) + deliveryCostCents;

    // Update total prices in the DOM
    const FREE_THRESHOLD_CENTS = 8000 * 100;
    const remainingToFreeCents = Math.max(0, FREE_THRESHOLD_CENTS - totalPriceWithoutVAT);

    const totalWithoutVATElement = document.querySelector(".total-without-vat");
    if (totalWithoutVATElement) {
      totalWithoutVATElement.innerHTML =
        `Celková cena (bes DPH): ${formatPrice(totalPriceWithoutVAT)}${
          remainingToFreeCents > 0
            ? `<span class="delivery-inline">Pro dopravu zdarma nakupte ještě za <span class="delivery-inline-amount">${formatPrice(remainingToFreeCents)}</span></span>`
            : "" // No extra span if delivery is free
        }`;
    }    
    const totalWithVATElement = document.querySelector(".total-with-vat");
    if (totalWithVATElement) {
      totalWithVATElement.textContent = `Celková cena (s DPH, 21 %): ${formatPrice(totalPriceWithVAT)}`;
    }

// delivery and final total
    const deliveryElement = document.querySelector(".delivery-cost");
    if (deliveryElement) {
      const FREE_THRESHOLD_CENTS = 8000 * 100;
      const remainingToFreeCents = Math.max(0, FREE_THRESHOLD_CENTS - totalPriceWithoutVAT);
     
    if (deliveryCostCents === 0) {
      deliveryElement.textContent = `Doprava: ${formatPrice(0)}`;
    } else {
      deliveryElement.textContent = `Doprava: ${formatPrice(deliveryCostCents)}`;
    }
      }
    const totalToPayElement = document.querySelector(".total-to-pay");
    if (totalToPayElement) {
      totalToPayElement.textContent = `Celkem k úhradě: ${formatPrice(totalToPayCents)}`;
    }
  };

  let updateOrderForm = () => {
    const orderForm = document.getElementById("order-form");
    // Only proceed if the order form is actually on the page
    if (!orderForm) {
      return;
    }
  
    const orderDetailsTextarea = orderForm.querySelector("textarea[name='orderDetails']");
    
    if (orderDetailsTextarea) {
      const newDetails = generateOrderDetails(fetchBasketData());
      // Use .value to set the content of a form element
      orderDetailsTextarea.value = newDetails; 
    }
  };

  let closeOrderForm = () => {
    const form = document.getElementById("order-form");
    if (form) {
      form.remove(); // Remove the order form from the DOM
      console.log("Order form has been closed.");
    }
  
    // Clear the state of the order form in localStorage
    localStorage.removeItem("orderFormOpen");
    localStorage.removeItem("orderFormData"); // Also clear the saved form data
  };