<?php
if (!empty($_POST['website_check'])) {
    die();
}
if (empty($_POST['name']) || empty($_POST['phone']) || empty($_POST['description'])) {
    die("Error: Please fill in all required fields.");
}
$name = strip_tags($_POST["name"]); 
$surname = strip_tags($_POST["surname"]);
$company = strip_tags($_POST["company"]);
$email = filter_var($_POST["email"], FILTER_SANITIZE_EMAIL);
$phone = strip_tags($_POST["phone"]);
$adress = strip_tags($_POST["adress"]);
$description = strip_tags($_POST["description"]);

$recipient = "info@rossoa.cz";
$subject = 'Objednávka z rossoa.cz';

$message = 
"Jméno: " . $name . "\r\n" .
"Příjmení: " . $surname . "\r\n" .
"Společnost: " . $company . "\r\n" .
"E-mail: " . $email . "\r\n" .
"Telefonní číslo: " . $phone . "\r\n" .
"Adresa objektů: " . $adress . "\r\n" .
"Zpráva: " . $description . "\r\n";

$headers = "From: info@rossoa.cz\r\n";
$headers .= "Reply-To: " . $email . "\r\n";
$headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
$headers .= "X-Mailer: PHP/" . phpversion();

if (mail($recipient, $subject, $message, $headers)) {
    echo "Success";
} else {
    http_response_code(500);
    echo "Error: Email failed to send.";
}
?>