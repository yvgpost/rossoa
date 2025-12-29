<?php
if (!empty($_POST['website_check'])) {
    // It's a bot, stop the script
    die();
}
  $name = $_POST["name"];
  $surname = $_POST["surname"];
  $company = $_POST["company"];
  $email = $_POST["email"];
  $phone = $_POST["phone"];
  $adress = $_POST["adress"];
  $description = $_POST["description"];
  $subject = 'Objednávka z rossoa.cz';
 
  $mailHeaders = 
  "\r\n Jméno: " . $name .
  "\r\n Příjmení: " . $surname .
  "\r\n Společnost: " . $company .
  "\r\n E-mail: " . $email . 
  "\r\n Telefonní číslo: " . $phone . 
  "\r\n Adresa objektů: " . $adress .
  "\r\n Zpráva: " . $description . "\r\n";
 
  $recipient = "info@rossoa.cz";

  mail($recipient, $subject, $mailHeaders)
  or die("Error!");
?>
    