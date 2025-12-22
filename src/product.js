// Import or include all product data arrays
const shopItemsData = [...cleanData, ...desinfectionData, ...combData, ...careData, ...specData];

let product = document.getElementById("target");

const formatPrice = (priceInCents) => {
  const price = priceInCents / 100; // Convert cents to decimal
  return new Intl.NumberFormat("cs-CZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price) + " Kč";
};

// Function to fetch data by id
let generateProduct = (id) => {
  const item = shopItemsData.find((product) => product.id === id); // Find item by id

  if (!item) {
    console.error("Product not found");
    return;
  }

  // Check if the product is already in the basket
  const search = basket.find((x) => x.id === id);

  product.innerHTML = `
     <div class="product" id="product-${item.id}">
      <ul class="product-breadcrumb">
        <li class="previous" onclick="window.open('store.html','_top' ); return false;">Prodej výrobků</li>
        <li class="previous" onclick="window.open('${item.link}','_top' ); return false;">${item.category}</li>
        <li>${item.productName}</li>
      </ul>
      <div class="product-container">
        <img src="${item.img}">
        <div class="product-container-content" style="background-color: ${item.categoryColor};">
            <p class="product-name">${item.productName}</p>
            <div class="product-description">
              <p class="product-description-text">${item.shortDescription}</p>
            </div>
              <div class="prices">
              <div class="price-per-unit">
                <p class="price-per-unit-text">Cena za ${item.unit}</p>
                <div class="price-per-unit-numbers">
                  <p class="vat">${formatPrice(item.preicePerKg)}</p>
                  <p class="no-vat">${formatPrice(item.pricePerKgVat)} s DPH</p>
                </div>
              </div>
              <div class="price-per-unit">
                <p class="price-per-unit-text">Cena balení</p>
                <div class="price-per-unit-numbers">
                  <p class="vat">${formatPrice(item.pricePerUnit)}</p>
                  <p class="no-vat">${formatPrice(item.pricePerUnitVat)} s DPH</p>
                </div>
              </div>
            </div>
            <div class="buy-button" id="buy-button-${id}">
              ${
                search
                  ? `
                    <button class="decrement" onclick="decrement(${id})">-</button>
                    <span class="counter">${search.item}</span>
                    <button class="increment" onclick="increment(${id})">+</button>
                  `
                  : `<button class="koupit" onclick="toggleBasket(${id})">Přidat do košíku</button>`
              }
            </div>
        </div>
      </div>
      </div>
  <div class="usage" id="usage">
  <div class="usage-container">
        <div class="usage-text">
          <div class="usage-content">
            <div class="usage-content-text">
              <p class="usage-content-text-title">Popis produktu</p>
              ${item.longDescription}
            </div>
          </div>
        </div>
        <div class="usage-text">
          <div class="usage-content">
            <div class="usage-content-text">
              <p class="usage-content-text-title">Návod k použití</p>
              ${item.howToUse}
            </div>
          </div>
        </div>
        <div class="usage-text">
          <div class="usage-content">
            <div class="usage-content-text">
              <p class="usage-content-text-title">Fyzikální a chemické vlastnosti</p>
              ${item.properties}
            </div>
         </div>
         <div class="usage-text">
          <div class="usage-content-documents">
            <div class="usage-content-text">
              <p class="usage-content-text-title">Dokumenty ke stažení</p>
            </div>
            <div class="documents-container">
              <div class="documents" onclick="window.open('/${item.safetySheet}','_top' ); return false;">
                <div class="pdf">
                  <img src="img/pdf.png">
                  <p>Bezpečnostní list</p>
                </div> 
              </div>
              <div class="documents" onclick="window.open('/${item.dataSheet}','_top' ); return false;">
                <div class="pdf">
                  <img src="img/pdf.png">
                  <p>Technický list</p>
                </div>
              </div>
            </div>
         </div>
    `;
};


// Function to toggle item in basket
let toggleBasket = (id) => {
  const search = basket.find((x) => x.id === id);

  if (!search) {
    // Add item to basket
    basket.push({ id: id, item: 1 });
    const button = document.getElementById(`buy-button-${id}`);
    if (button) {
      button.innerHTML = `
        <button class="decrement" onclick="decrement(${id})">-</button>
        <span class="counter">1</span>
        <button class="increment" onclick="increment(${id})">+</button>
      `;
    }
    console.log("Added to basket:", basket);
  }

  // Save basket to local storage
  localStorage.setItem("basket", JSON.stringify(basket));

  // Update the basket state dynamically
  calculation();
};

let increment = (id) => {
  const search = basket.find((x) => x.id === id);

  if (search) {
    // Increase the quantity by 1
    search.item += 1;
    const counter = document.querySelector(`#buy-button-${id} .counter`);
    if (counter) {
      counter.textContent = search.item; // Update the counter display
    }
    console.log(`Incremented item with id ${id}:`, basket);
  }

  // Save basket to local storage
  localStorage.setItem("basket", JSON.stringify(basket));

  // Update the basket state dynamically
  calculation();
};

let decrement = (id) => {
  const search = basket.find((x) => x.id === id);

  if (search && search.item > 1) {
    // Decrease the quantity by 1
    search.item -= 1;
    const counter = document.querySelector(`#buy-button-${id} .counter`);
    if (counter) {
      counter.textContent = search.item; // Update the counter display
    }
    console.log(`Decremented item with id ${id}:`, basket);
  } else if (search && search.item === 1) {
    // Remove item from basket if quantity is 1
    basket = basket.filter((x) => x.id !== id);
    const button = document.getElementById(`buy-button-${id}`);
    if (button) {
      button.innerHTML = `<button class="koupit" onclick="toggleBasket(${id})">Přidat do košíku</button>`;
    }
    console.log(`Removed item with id ${id} from basket:`, basket);
  }

  // Save basket to local storage
  localStorage.setItem("basket", JSON.stringify(basket));

  // Update the basket state dynamically
  calculation();
};

// Get the id from the URL
const urlParams = new URLSearchParams(window.location.search);
const productId = parseInt(urlParams.get("id"), 10);

// Call the function with the id from the URL
generateProduct(productId);

let update = (id) => {
  let search = basket.find((x) => x.id === id);

  if (!search) {
    console.log(`Item with id ${id} not found in basket.`);
    return; // Exit the function if the item is not found
  }

  console.log(`Quantity of item with id ${id}:`, search.item);
  calculation();
};

console.log(formatPrice);