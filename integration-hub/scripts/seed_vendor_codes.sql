-- ============================================================
-- HotelBeds Facility Groups (code_type = 'facility_group')
-- ============================================================
INSERT INTO hub_vendor_codes (supplier_slug, code_type, code, group_code, label) VALUES
  ('hotelbeds-hotels', 'facility_group', '10', NULL, 'Hotel Info'),
  ('hotelbeds-hotels', 'facility_group', '20', NULL, 'Hotel Type'),
  ('hotelbeds-hotels', 'facility_group', '30', NULL, 'Payment & Services'),
  ('hotelbeds-hotels', 'facility_group', '40', NULL, 'Distances'),
  ('hotelbeds-hotels', 'facility_group', '60', NULL, 'Room Facilities'),
  ('hotelbeds-hotels', 'facility_group', '70', NULL, 'Hotel Facilities'),
  ('hotelbeds-hotels', 'facility_group', '71', NULL, 'Entertainment'),
  ('hotelbeds-hotels', 'facility_group', '72', NULL, 'Health & Wellness'),
  ('hotelbeds-hotels', 'facility_group', '73', NULL, 'Business'),
  ('hotelbeds-hotels', 'facility_group', '74', NULL, 'Accessibility'),
  ('hotelbeds-hotels', 'facility_group', '80', NULL, 'Room Info'),
  ('hotelbeds-hotels', 'facility_group', '85', NULL, 'Sustainability'),
  ('hotelbeds-hotels', 'facility_group', '90', NULL, 'Renovation'),
  ('hotelbeds-hotels', 'facility_group', '91', NULL, 'Cleaning & Safety')
ON CONFLICT (supplier_slug, code_type, code, group_code) DO UPDATE SET label = EXCLUDED.label;

-- ============================================================
-- Group 10: Hotel Info
-- ============================================================
INSERT INTO hub_vendor_codes (supplier_slug, code_type, code, group_code, label) VALUES
  ('hotelbeds-hotels', 'facility', '10', '10', 'Year Built'),
  ('hotelbeds-hotels', 'facility', '20', '10', 'Year of Last Renovation'),
  ('hotelbeds-hotels', 'facility', '30', '10', 'Total Rooms'),
  ('hotelbeds-hotels', 'facility', '40', '10', 'Total Floors'),
  ('hotelbeds-hotels', 'facility', '50', '10', 'Number of Elevators'),
  ('hotelbeds-hotels', 'facility', '60', '10', 'Number of Restaurants'),
  ('hotelbeds-hotels', 'facility', '70', '10', 'Number of Conference Rooms'),
  ('hotelbeds-hotels', 'facility', '80', '10', 'Number of Bars'),
  ('hotelbeds-hotels', 'facility', '90', '10', 'Number of Suites')
ON CONFLICT (supplier_slug, code_type, code, group_code) DO UPDATE SET label = EXCLUDED.label;

-- ============================================================
-- Group 20: Hotel Type
-- ============================================================
INSERT INTO hub_vendor_codes (supplier_slug, code_type, code, group_code, label) VALUES
  ('hotelbeds-hotels', 'facility', '10', '20', 'City Hotel'),
  ('hotelbeds-hotels', 'facility', '20', '20', 'Beach Hotel'),
  ('hotelbeds-hotels', 'facility', '30', '20', 'Mountain Hotel'),
  ('hotelbeds-hotels', 'facility', '40', '20', 'Resort'),
  ('hotelbeds-hotels', 'facility', '50', '20', 'Budget Hotel'),
  ('hotelbeds-hotels', 'facility', '60', '20', 'Boutique Hotel'),
  ('hotelbeds-hotels', 'facility', '70', '20', 'Apartment Hotel'),
  ('hotelbeds-hotels', 'facility', '80', '20', 'Rural Hotel')
ON CONFLICT (supplier_slug, code_type, code, group_code) DO UPDATE SET label = EXCLUDED.label;

-- ============================================================
-- Group 30: Payment & Services
-- ============================================================
INSERT INTO hub_vendor_codes (supplier_slug, code_type, code, group_code, label) VALUES
  ('hotelbeds-hotels', 'facility', '10', '30', 'American Express'),
  ('hotelbeds-hotels', 'facility', '20', '30', 'Visa'),
  ('hotelbeds-hotels', 'facility', '30', '30', 'Euro/Mastercard'),
  ('hotelbeds-hotels', 'facility', '40', '30', 'Diners Club'),
  ('hotelbeds-hotels', 'facility', '50', '30', 'JCB'),
  ('hotelbeds-hotels', 'facility', '60', '30', 'Discover')
ON CONFLICT (supplier_slug, code_type, code, group_code) DO UPDATE SET label = EXCLUDED.label;

-- ============================================================
-- Group 40: Distances
-- ============================================================
INSERT INTO hub_vendor_codes (supplier_slug, code_type, code, group_code, label) VALUES
  ('hotelbeds-hotels', 'facility', '10', '40', 'Distance to Beach'),
  ('hotelbeds-hotels', 'facility', '20', '40', 'Distance to City Centre'),
  ('hotelbeds-hotels', 'facility', '30', '40', 'Distance to Airport'),
  ('hotelbeds-hotels', 'facility', '40', '40', 'Distance to Golf Course'),
  ('hotelbeds-hotels', 'facility', '50', '40', 'Distance to Train Station'),
  ('hotelbeds-hotels', 'facility', '60', '40', 'Distance to Bus Stop'),
  ('hotelbeds-hotels', 'facility', '70', '40', 'Distance to Fair/Convention'),
  ('hotelbeds-hotels', 'facility', '80', '40', 'Distance to Ski Lift')
ON CONFLICT (supplier_slug, code_type, code, group_code) DO UPDATE SET label = EXCLUDED.label;

-- ============================================================
-- Group 60: Room Facilities
-- ============================================================
INSERT INTO hub_vendor_codes (supplier_slug, code_type, code, group_code, label) VALUES
  ('hotelbeds-hotels', 'facility', '10', '60', 'Bathroom'),
  ('hotelbeds-hotels', 'facility', '20', '60', 'Shower'),
  ('hotelbeds-hotels', 'facility', '30', '60', 'Bathtub'),
  ('hotelbeds-hotels', 'facility', '40', '60', 'Hair Dryer'),
  ('hotelbeds-hotels', 'facility', '50', '60', 'Minibar'),
  ('hotelbeds-hotels', 'facility', '55', '60', 'Refrigerator'),
  ('hotelbeds-hotels', 'facility', '60', '60', 'Telephone'),
  ('hotelbeds-hotels', 'facility', '70', '60', 'Television'),
  ('hotelbeds-hotels', 'facility', '80', '60', 'Satellite/Cable TV'),
  ('hotelbeds-hotels', 'facility', '90', '60', 'Radio'),
  ('hotelbeds-hotels', 'facility', '100', '60', 'Air Conditioning'),
  ('hotelbeds-hotels', 'facility', '110', '60', 'Heating'),
  ('hotelbeds-hotels', 'facility', '120', '60', 'Safe'),
  ('hotelbeds-hotels', 'facility', '130', '60', 'Terrace/Balcony'),
  ('hotelbeds-hotels', 'facility', '140', '60', 'Iron'),
  ('hotelbeds-hotels', 'facility', '150', '60', 'Trouser Press'),
  ('hotelbeds-hotels', 'facility', '160', '60', 'Kitchen/Kitchenette'),
  ('hotelbeds-hotels', 'facility', '170', '60', 'Microwave'),
  ('hotelbeds-hotels', 'facility', '180', '60', 'Coffee/Tea Maker'),
  ('hotelbeds-hotels', 'facility', '190', '60', 'Internet Access'),
  ('hotelbeds-hotels', 'facility', '200', '60', 'Wi-Fi'),
  ('hotelbeds-hotels', 'facility', '210', '60', 'Desk'),
  ('hotelbeds-hotels', 'facility', '220', '60', 'Sofa Bed'),
  ('hotelbeds-hotels', 'facility', '230', '60', 'Crib Available'),
  ('hotelbeds-hotels', 'facility', '240', '60', 'Washing Machine'),
  ('hotelbeds-hotels', 'facility', '250', '60', 'Dishwasher'),
  ('hotelbeds-hotels', 'facility', '261', '60', 'Flat-Screen TV'),
  ('hotelbeds-hotels', 'facility', '275', '60', 'USB Charging'),
  ('hotelbeds-hotels', 'facility', '287', '60', 'Smart TV'),
  ('hotelbeds-hotels', 'facility', '298', '60', 'Bluetooth Speaker')
ON CONFLICT (supplier_slug, code_type, code, group_code) DO UPDATE SET label = EXCLUDED.label;

-- ============================================================
-- Group 70: Hotel Facilities (largest group)
-- ============================================================
INSERT INTO hub_vendor_codes (supplier_slug, code_type, code, group_code, label) VALUES
  ('hotelbeds-hotels', 'facility', '10', '70', '24-Hour Reception'),
  ('hotelbeds-hotels', 'facility', '20', '70', 'Car Park'),
  ('hotelbeds-hotels', 'facility', '30', '70', 'Garden'),
  ('hotelbeds-hotels', 'facility', '40', '70', 'Terrace'),
  ('hotelbeds-hotels', 'facility', '50', '70', 'Non-Smoking Rooms'),
  ('hotelbeds-hotels', 'facility', '60', '70', 'Newspaper'),
  ('hotelbeds-hotels', 'facility', '70', '70', 'Restaurant'),
  ('hotelbeds-hotels', 'facility', '80', '70', 'Buffet Restaurant'),
  ('hotelbeds-hotels', 'facility', '90', '70', 'Bar'),
  ('hotelbeds-hotels', 'facility', '100', '70', 'Swimming Pool'),
  ('hotelbeds-hotels', 'facility', '110', '70', 'Indoor Swimming Pool'),
  ('hotelbeds-hotels', 'facility', '120', '70', 'Heated Swimming Pool'),
  ('hotelbeds-hotels', 'facility', '125', '70', 'Children''s Pool'),
  ('hotelbeds-hotels', 'facility', '130', '70', 'Gym/Fitness'),
  ('hotelbeds-hotels', 'facility', '135', '70', 'Sauna'),
  ('hotelbeds-hotels', 'facility', '140', '70', 'Spa'),
  ('hotelbeds-hotels', 'facility', '150', '70', 'Jacuzzi'),
  ('hotelbeds-hotels', 'facility', '160', '70', 'Turkish Bath'),
  ('hotelbeds-hotels', 'facility', '170', '70', 'Tennis Court'),
  ('hotelbeds-hotels', 'facility', '180', '70', 'Golf Course'),
  ('hotelbeds-hotels', 'facility', '190', '70', 'Room Service'),
  ('hotelbeds-hotels', 'facility', '200', '70', 'Laundry Service'),
  ('hotelbeds-hotels', 'facility', '210', '70', 'Medical Service'),
  ('hotelbeds-hotels', 'facility', '220', '70', 'Babysitting'),
  ('hotelbeds-hotels', 'facility', '230', '70', 'Currency Exchange'),
  ('hotelbeds-hotels', 'facility', '240', '70', 'Wi-Fi'),
  ('hotelbeds-hotels', 'facility', '250', '70', 'Internet Corner'),
  ('hotelbeds-hotels', 'facility', '260', '70', 'Check-in Time'),
  ('hotelbeds-hotels', 'facility', '261', '70', 'Check-in From'),
  ('hotelbeds-hotels', 'facility', '270', '70', 'Early Check-in'),
  ('hotelbeds-hotels', 'facility', '280', '70', 'Late Check-out'),
  ('hotelbeds-hotels', 'facility', '290', '70', 'Express Check-in/Check-out'),
  ('hotelbeds-hotels', 'facility', '295', '70', 'Pets Allowed'),
  ('hotelbeds-hotels', 'facility', '300', '70', 'Bicycle Rental'),
  ('hotelbeds-hotels', 'facility', '310', '70', 'Car Rental'),
  ('hotelbeds-hotels', 'facility', '320', '70', 'Parking'),
  ('hotelbeds-hotels', 'facility', '330', '70', 'Valet Parking'),
  ('hotelbeds-hotels', 'facility', '340', '70', 'Airport Shuttle'),
  ('hotelbeds-hotels', 'facility', '350', '70', 'Wheelchair Access'),
  ('hotelbeds-hotels', 'facility', '360', '70', 'Elevator'),
  ('hotelbeds-hotels', 'facility', '370', '70', 'Concierge'),
  ('hotelbeds-hotels', 'facility', '380', '70', 'Doorman'),
  ('hotelbeds-hotels', 'facility', '390', '70', 'Check-out Time'),
  ('hotelbeds-hotels', 'facility', '400', '70', 'Dry Cleaning'),
  ('hotelbeds-hotels', 'facility', '410', '70', 'Ironing Service'),
  ('hotelbeds-hotels', 'facility', '420', '70', 'Shoe Shine'),
  ('hotelbeds-hotels', 'facility', '430', '70', 'Luggage Storage'),
  ('hotelbeds-hotels', 'facility', '440', '70', 'Tour Desk'),
  ('hotelbeds-hotels', 'facility', '450', '70', 'Snack Bar'),
  ('hotelbeds-hotels', 'facility', '460', '70', 'Poolside Bar'),
  ('hotelbeds-hotels', 'facility', '470', '70', 'Café'),
  ('hotelbeds-hotels', 'facility', '480', '70', 'Nightclub'),
  ('hotelbeds-hotels', 'facility', '490', '70', 'Casino'),
  ('hotelbeds-hotels', 'facility', '500', '70', 'Private Beach'),
  ('hotelbeds-hotels', 'facility', '510', '70', 'Beach Umbrellas'),
  ('hotelbeds-hotels', 'facility', '520', '70', 'Sun Loungers'),
  ('hotelbeds-hotels', 'facility', '525', '70', 'Rooftop Terrace'),
  ('hotelbeds-hotels', 'facility', '530', '70', 'Water Sports'),
  ('hotelbeds-hotels', 'facility', '540', '70', 'Diving Centre'),
  ('hotelbeds-hotels', 'facility', '550', '70', 'Air Conditioning'),
  ('hotelbeds-hotels', 'facility', '560', '70', 'Heating'),
  ('hotelbeds-hotels', 'facility', '570', '70', 'Mini Golf'),
  ('hotelbeds-hotels', 'facility', '575', '70', 'Playground'),
  ('hotelbeds-hotels', 'facility', '580', '70', 'Kids Club')
ON CONFLICT (supplier_slug, code_type, code, group_code) DO UPDATE SET label = EXCLUDED.label;

-- ============================================================
-- Group 71: Entertainment
-- ============================================================
INSERT INTO hub_vendor_codes (supplier_slug, code_type, code, group_code, label) VALUES
  ('hotelbeds-hotels', 'facility', '10', '71', 'Live Entertainment'),
  ('hotelbeds-hotels', 'facility', '20', '71', 'Live Music'),
  ('hotelbeds-hotels', 'facility', '30', '71', 'Animation/Shows'),
  ('hotelbeds-hotels', 'facility', '40', '71', 'Cinema'),
  ('hotelbeds-hotels', 'facility', '50', '71', 'Karaoke'),
  ('hotelbeds-hotels', 'facility', '100', '71', 'Disco'),
  ('hotelbeds-hotels', 'facility', '200', '71', 'Game Room')
ON CONFLICT (supplier_slug, code_type, code, group_code) DO UPDATE SET label = EXCLUDED.label;

-- ============================================================
-- Group 72: Health & Wellness
-- ============================================================
INSERT INTO hub_vendor_codes (supplier_slug, code_type, code, group_code, label) VALUES
  ('hotelbeds-hotels', 'facility', '10', '72', 'Spa'),
  ('hotelbeds-hotels', 'facility', '20', '72', 'Massage'),
  ('hotelbeds-hotels', 'facility', '30', '72', 'Sauna'),
  ('hotelbeds-hotels', 'facility', '40', '72', 'Steam Room'),
  ('hotelbeds-hotels', 'facility', '50', '72', 'Beauty Salon'),
  ('hotelbeds-hotels', 'facility', '60', '72', 'Solarium'),
  ('hotelbeds-hotels', 'facility', '100', '72', 'Yoga'),
  ('hotelbeds-hotels', 'facility', '575', '72', 'Kids Pool'),
  ('hotelbeds-hotels', 'facility', '580', '72', 'Kids Club'),
  ('hotelbeds-hotels', 'facility', '605', '72', 'Water Park')
ON CONFLICT (supplier_slug, code_type, code, group_code) DO UPDATE SET label = EXCLUDED.label;

-- ============================================================
-- Group 73: Business
-- ============================================================
INSERT INTO hub_vendor_codes (supplier_slug, code_type, code, group_code, label) VALUES
  ('hotelbeds-hotels', 'facility', '10', '73', 'Business Centre'),
  ('hotelbeds-hotels', 'facility', '20', '73', 'Conference Room'),
  ('hotelbeds-hotels', 'facility', '30', '73', 'Meeting Rooms'),
  ('hotelbeds-hotels', 'facility', '40', '73', 'Printer/Fax'),
  ('hotelbeds-hotels', 'facility', '350', '73', 'Accessible Meeting Rooms'),
  ('hotelbeds-hotels', 'facility', '363', '73', 'Number of Meeting Rooms'),
  ('hotelbeds-hotels', 'facility', '395', '73', 'Co-Working Space')
ON CONFLICT (supplier_slug, code_type, code, group_code) DO UPDATE SET label = EXCLUDED.label;

-- ============================================================
-- Group 74: Accessibility
-- ============================================================
INSERT INTO hub_vendor_codes (supplier_slug, code_type, code, group_code, label) VALUES
  ('hotelbeds-hotels', 'facility', '10', '74', 'Wheelchair Accessible'),
  ('hotelbeds-hotels', 'facility', '20', '74', 'Accessible Bathroom'),
  ('hotelbeds-hotels', 'facility', '30', '74', 'Roll-In Shower'),
  ('hotelbeds-hotels', 'facility', '40', '74', 'Hearing Accessible'),
  ('hotelbeds-hotels', 'facility', '50', '74', 'Visual Aids')
ON CONFLICT (supplier_slug, code_type, code, group_code) DO UPDATE SET label = EXCLUDED.label;

-- ============================================================
-- Group 85: Sustainability
-- ============================================================
INSERT INTO hub_vendor_codes (supplier_slug, code_type, code, group_code, label) VALUES
  ('hotelbeds-hotels', 'facility', '550', '85', 'EV Charging Station'),
  ('hotelbeds-hotels', 'facility', '555', '85', 'Solar Energy'),
  ('hotelbeds-hotels', 'facility', '560', '85', 'Recycling Programme'),
  ('hotelbeds-hotels', 'facility', '562', '85', 'Green Certification'),
  ('hotelbeds-hotels', 'facility', '565', '85', 'No Single-Use Plastics'),
  ('hotelbeds-hotels', 'facility', '570', '85', 'Locally Sourced Food')
ON CONFLICT (supplier_slug, code_type, code, group_code) DO UPDATE SET label = EXCLUDED.label;

-- ============================================================
-- Group 90: Renovation
-- ============================================================
INSERT INTO hub_vendor_codes (supplier_slug, code_type, code, group_code, label) VALUES
  ('hotelbeds-hotels', 'facility', '350', '90', 'Under Renovation')
ON CONFLICT (supplier_slug, code_type, code, group_code) DO UPDATE SET label = EXCLUDED.label;

-- ============================================================
-- Group 91: Cleaning & Safety
-- ============================================================
INSERT INTO hub_vendor_codes (supplier_slug, code_type, code, group_code, label) VALUES
  ('hotelbeds-hotels', 'facility', '10', '91', 'Enhanced Cleaning'),
  ('hotelbeds-hotels', 'facility', '20', '91', 'Social Distancing'),
  ('hotelbeds-hotels', 'facility', '30', '91', 'Hand Sanitiser'),
  ('hotelbeds-hotels', 'facility', '40', '91', 'Contactless Check-in'),
  ('hotelbeds-hotels', 'facility', '50', '91', 'Staff Wear PPE'),
  ('hotelbeds-hotels', 'facility', '60', '91', 'Guest Temperature Checks'),
  ('hotelbeds-hotels', 'facility', '97', '91', 'Temporarily Closed')
ON CONFLICT (supplier_slug, code_type, code, group_code) DO UPDATE SET label = EXCLUDED.label;

-- ============================================================
-- HotelBeds Board Types (meal plans)
-- ============================================================
INSERT INTO hub_vendor_codes (supplier_slug, code_type, code, group_code, label) VALUES
  ('hotelbeds-hotels', 'board', 'RO', NULL, 'Room Only'),
  ('hotelbeds-hotels', 'board', 'BB', NULL, 'Bed & Breakfast'),
  ('hotelbeds-hotels', 'board', 'HB', NULL, 'Half Board'),
  ('hotelbeds-hotels', 'board', 'FB', NULL, 'Full Board'),
  ('hotelbeds-hotels', 'board', 'AI', NULL, 'All Inclusive'),
  ('hotelbeds-hotels', 'board', 'SC', NULL, 'Self Catering')
ON CONFLICT (supplier_slug, code_type, code, group_code) DO UPDATE SET label = EXCLUDED.label;
