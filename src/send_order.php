<?php
// filepath: /Users/yvg/repos/donite/src/send_order.php

if ($_SERVER["REQUEST_METHOD"] == "POST") {
    // --- Get Customer Details ---
    $name = htmlspecialchars($_POST['name'] ?? 'N/A');
    $surname = htmlspecialchars($_POST['surname'] ?? 'N/A');
    $companyName = htmlspecialchars($_POST['companyName'] ?? 'N/A');
    $icNumber = htmlspecialchars($_POST['icNumber'] ?? 'N/A');
    $dicNumber = htmlspecialchars($_POST['dicNumber'] ?? 'N/A');
    $email = htmlspecialchars($_POST['email'] ?? 'N/A');
    $phone = htmlspecialchars($_POST['phone'] ?? 'N/A');
    $deliveryAddress = htmlspecialchars($_POST['deliveryAddress'] ?? 'N/A');

    // --- Get the complete Order Details text block ---
    $orderDetails = htmlspecialchars($_POST['orderDetails'] ?? 'No order details provided.');

    // --- Email Configuration ---
    $to = "your-email@example.com"; // REPLACE WITH YOUR EMAIL ADDRESS
    $subject = "Nová objednávka od " . $name . " " . $surname;

    // --- Build the Email Body ---
    $email_body = "Byla přijata nová objednávka.\n\n";
    $email_body .= "================================\n";
    $email_body .= "ÚDAJE ZÁKAZNÍKA\n";
    $email_body .= "================================\n";
    $email_body .= "Jméno: $name $surname\n";
    $email_body .= "Společnost: $companyName\n";
    $email_body .= "IČ: $icNumber\n";
    $email_body .= "DIČ: $dicNumber\n";
    $email_body .= "Email: $email\n";
    $email_body .= "Telefon: $phone\n";
    $email_body .= "Doručovací adresa:\n$deliveryAddress\n\n";
    $email_body .= "================================\n";
    $email_body .= "PODROBNOSTI OBJEDNÁVKY\n";
    $email_body .= "================================\n";
    $email_body .= $orderDetails; // This includes the products and totals

    // --- Set Email Headers ---
    $headers = "From: no-reply@yourwebsite.com" . "\r\n" .
               "Reply-To: " . $email;

    // --- Send the Email ---
    if (mail($to, $subject, $email_body, $headers)) {
        // If mail is sent successfully, send a 200 OK response
        http_response_code(200);
        echo "Order sent successfully.";
    } else {
        // If mail fails, send a 500 Internal Server Error response
        http_response_code(500);
        echo "Failed to send order email.";
    }
} else {
    // If not a POST request, send a 405 Method Not Allowed response
    http_response_code(405);
    echo "Invalid request method.";
}
?>