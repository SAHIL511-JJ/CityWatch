const environmentalCategories = <String>[
  'flooding',
  'waterlogging',
  'blocked_drain',
  'waste',
  'sewage',
  'plastic',
  'pollution',
  'damaged_infrastructure',
  'other_environmental_condition',
];

const environmentalCategoryLabels = <String, String>{
  'flooding': 'Flooding',
  'waterlogging': 'Waterlogging',
  'blocked_drain': 'Blocked drain',
  'waste': 'Waste',
  'sewage': 'Sewage',
  'plastic': 'Plastic',
  'pollution': 'Pollution',
  'damaged_infrastructure': 'Damaged infrastructure',
  'other_environmental_condition': 'Other environmental condition',
};

String environmentalCategoryLabel(String value) =>
    environmentalCategoryLabels[value] ?? 'Other environmental condition';

