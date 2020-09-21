const { getEager } = require('./util');

const FieldSubType = exports.FieldSubType = {
    NA: 0,
    Text: 1,
    Http: 2,   // This is a fixed link
    Date: 3,
    YesNo: 4,
    List: 5,
    Divider: 6,
    Money: 7,
    Label: 8,
    Description: 9,
    ListMultiSelect: 10,
    TextArea: 11,
    Link: 12,
    DeprecatedTable: 13,
    Number: 14,
    DeprecatedFormula2: 15,    // Refers to a formula money field
    Money4: 16,
    Percent: 17,
    DeprecatedFormula4: 18,    // Refers to a formula money field
    FixedNumber: 19, // Fixed
    SpecialPhone: 20,
    LocationLatLong: 21,
    Decimal: 22,
    LocationUTM: 23,
    LocationDLS: 24,
    LocationNTS: 25,
    WellUWI: 26,
    WellAPI: 27,
    DateTime: 28,
    DescriptionTable: 29,
    DeprecatedFormulaDecimal: 30,
    MeasureLengthSmall: 31,
    MeasureLengthMedium: 32,
    MeasurePressure: 33,
    MeasureArea: 34,
    MeasureWeight: 35,
    MeasureForce: 36,
    MeasureDensity: 37,
    MeasureFlow: 38,
    MeasureTemperature: 39,
    DeprecatedFormulaQuantity: 40,
    YesNoList: 41,
    ListScore: 42,
    Html: 43, // Fixed
    LocationList: 44,
    FieldTable: 45,
    FieldTableDefinedRow: 46,
    FormulaField: 47,
    MeasureVolumeSmall: 48,
    MeasureVolumeMedium: 49,
    MeasureVolumeLarge: 50,
    MeasureLengthLarge: 51,
    Duration: 52,
    Email: 53,
};

exports.ProcessPermission = {
    HideAll: 1,
    Edit: 3,
    EditOwnHideOthers: 8,
    ReadOwnHideOthers: 10,
    ReadAll: 11,
    Start: 12,
    StartOwnHideOthers: 13,
    EditOwnReadOthers: 14,
    StartOwnReadOthers: 15,
    StartHideAll: 17
};

exports.PhoneType = {
    Business: 1,
    Home: 2,
    Fax: 3,
    Other: 6
};

exports.ObjectType = {
    NA: 0,
    AgentRep: 1,
    SubscriberSupport: 2,
    Staff: 3,
    Administrator: 4,
    Customer: 5,
    SubAgent: 6,
    AgentMgr: 7,
    CustomerContact: 8,
    Subscriber: 9,
    CommissionRun: 10,
    SystemName: 11,
    ProductVariables: 12,
    ItemVariables: 13,
    CustomerLocation: 14,
    CustomerAlias: 15,
    Instance: 17,
    Brand: 19,
    Agreement: 20,
    Lead: 100,
    Quote: 101,
    Order: 102,
    State: 110,
    Country: 111,
    AgentCompany: 200,
    CommissionGroup: 201,
    CustomerAccountGroup: 202,
    Supplier: 203,
    RefPartner: 204,
    SupplierExclusion: 205,
    AgencyGroup: 206,
    CommAdjType: 300,
    Product: 303,
    CustomerAccount: 304,
    CommTier: 305,
    AgentSplitAdden: 306,
    AgentCommAdden: 307,
    AgentProductAdden: 308,
    AgentBaseAdden: 309,
    AgentAccountAdden: 310,
    CommissionItem: 311,
    CommissionItemSplit: 312,
    CommissionItemOrigin: 313,
    AgentCommSched: 314,
    AgentCommValue: 315,
    CommBaseSchedMod: 316,
    MasterDes: 318,
    AgentDes: 319,
    CommDeposit: 320,
    CommMatrix: 321, // we have multiple import matrixes 
    Notes: 323, // These notes are used for search by fields, but are unused
    Quota: 324, // this is for old quota that was removed from system CR 10435
    IssueText: 325,
    CommissionAdjustment: 326,
    CommissionRefRule: 327,
    DataExportTemplate: 330,
    CommSupplierTotal: 350,
    SupplierExtranet: 400,
    SupplierExtranetLogin: 401,
    CommImportTemp: 411,
    CommName: 420,
    CommItemTransfer: 421,
    FileAttachment: 450,
    ECItem: 470,
    ECTemplate: 471,
    CustomField: 500,
    CustomFieldValue: 501,
    CustomFieldListSelectedItem: 502,
    FormField: 503,
    TableFieldRow: 504,
    PMFieldField: 505,
    PMTemplate: 510,
    PMStatus: 511,
    PMTemplateReference: 512,  // To be phased out.  This type is redundant with 522 for our purposes.
    SharedField: 513,
    PMActionTrigger: 515,
    PMFieldGroup: 516,
    ActionType: 517,
    RestrictedReference: 519,
    Form: 520,
    FormStatus: 521,
    FormReference: 522,
    FormOwner: 523,
    FormParticipant: 524,
    FormAction: 525,
    FormEmail: 526,
    FormSummary: 530,
    FormHistory: 531,
    FormSignature: 532,
    ArchivedAccountGroup: 538,
    ArchivedCommissionItemSplit: 539,
    ArchivedFormParticipant: 540,
    ArchivedFormOwner: 541,
    ArchivedFormStaffReferenced: 542,
    ArchivedCustomer: 543,
    ArchivedAccount: 544,
    ArchivedCommisionItem: 545,
    ArchivedRep: 546,
    ArchivedAgency: 547,
    ArchivedSupplier: 548,
    ArchivedProduct: 549,
    StatusTrigger: 550,
    Approval: 560,
    ApprovalStage: 561,
    ProcessFlow: 565,
    Holder: 580,
    HolderModifiedDate: 581, // for view
    FolderFiles: 582, // for view
    NoFolderFiles: 583, // for view
    Role: 600,
    StaffGroup: 601,
    RolePrivilege: 602,
    RolePermsission: 603,
    AgencyAssignment: 620,
    AgencyAssignmentCategory: 621,
    CalendarAction: 650,
    CalendarDate: 651,
    Cview: 700,
    Cview_ColumnOption: 710,
    Cview_FilterOption: 711,
    AgencyReferral: 715,
    Referral: 716,
    FormLayout: 741,
    PhoneType: 800,
    TemporaryLogo: 851,
    Reconciles: 900,
    Reconcile: 901,
    SuperUserBillingLevel: 950,
    StaticField: 9999,  // Refers to fields like Customer.Website or Contact.FirstName.  Some static fields are shared fields.
    NetBilledForRun: 10000,
    PayoutForRun: 10001,
    GrossCommForRun: 10002,
    GrossProfitForRun: 10003,
    Wholesale: 10004,
    Margin: 10005,
    AgentComm: 10006,
    ContractValue: 10007,
    CommReferralTo: 10008,
    AgencyPayout: 10017,
    CommReferral: 10022,
    Origin: 10040,
    Access: 10041,
    Enabled: 10042,
    Email: 10050,
    FormNumber: 10060,
    BusinessPhone: 10070,
    HomePhone: 10071,
    FaxPhone: 10072,
    OtherPhone: 10073,
    Website: 10074,
    CountryAddress: 10075,
    Modified: 10076,
    Company: 10077,
    User: 10078,
    PrimaryContact: 10100,
    ContactInfo: 10101,
    StreetAddress: 10102,
    City: 10103,
    StateAddress: 10104,
    ZipCode: 10105,
    Added: 10106,
    Title: 10107,
    RepType: 10108,
    Phone: 10109,
    Latitude: 10110,
    FirstName: 10112,
    LastName: 10113,
    Rename_Reps: 10121,
    Rename_Rep: 10120,
    Rename_Managers: 10122,
    Rename_Manager: 10123,
    Rename_Agency: 10124,
    Rename_Agencies: 10125,
    FieldFieldStaticOption: 10140,
    BardCode: 10200,
    FormStarted: 10201,
    Owner: 10202,
    SelectForm: 10300,
    ShellViewProcess: 10400,
    ShellProcessSingle: 10401,
    ShellAgencyView: 10402,
    ShellAgencySingle: 10403,
    ShellRepView: 10404,
    ShellRepSingle: 10405,
    ShellCustomerView: 10406,
    ShellCustomerSingle: 10407,
    ShellAccountView: 10408,
    ShellAccountSingle: 10409,
    ShellCommItemView: 10410,
    ShellCommItemSingle: 10411,
    ShellStaffView: 10412,
    ShellStaffSingle: 10413,
    NotesForStaff: 10500,
    NotesForAgents: 10501,
    HomePage: 10550,
    ProcessHolder: 10551,
    HolderFlow: 10607,
    HolderFileAttachment: 10608,
    HolderProcess: 10600,
    ViewDownload: 10609,
    ImportFile: 10610
};

exports.RefSubType = {
    NA: 0,
    AgentRep: 1,
    SubscriberSupport: 2,
    Staff: 3,
    Administrator: 4,
    Customer: 5,
    SubAgent: 6,
    AgentMgr: 7,
    CustomerContact: 8,
    Subscriber: 9,
    CommissionRun: 10,
    SystemName: 11,
    CustomerLocation: 14,
    CustomerAlias: 15,
    Deployment: 17,
    Carrier: 20,
    Lead: 100,
    Quote: 101,
    Order: 102,
    State: 110,
    Country: 111,
    AgentCompany: 200,
    CommissionGroup: 201,
    CustomerAccountGroup: 202,
    Supplier: 203,
    RefPartner: 204,
    SupplierExclusion: 205,
    Product: 303,
    CustomerAccount: 304,
    CommTier: 305,
    AgentSplitAdden: 306,
    AgentCommAdden: 307,
    AgentProductAdden: 308,
    AgentBaseAdden: 309,
    AgentAccountAdden: 310,
    CommissionItem: 311,
    CommissionItemSplit: 312,
    CommissionItemOrigin: 313,
    AgentCommSched: 314,
    AgentCommValue: 315,
    CommBaseSchedMod: 316,
    MasterDes: 318,
    AgentDes: 319,
    CommDeposit: 320,
    Notes: 323, // These notes are used for search by fields, but are unused
    Quota: 324, // this is for old quota that was removed from system CR 10435
    IssueText: 325,
    CommissionAdjustment: 326,
    CommissionRefRule: 327,
    DataExportTemplate: 330,
    CommSupplierTotal: 350,
    SupplierExtranet: 400,
    SupplierExtranetLogin: 401,
    CommImportTemp: 411,
    CommItemTransfer: 421,
    FileAttachment: 450,
    ECItem: 470,
    ECTemplate: 471,
    CustomField: 500,
    CustomFieldValue: 501,
    CustomFieldListSelectedItem: 502,
    FormField: 503,
    TableFieldRow: 504,
    FieldReference: 505,
    PMTemplate: 510,
    PMStatus: 511,
    PMTemplateReference: 512,  // To be phased out.  This type is redundant with 522 for our purposes.
    SharedField: 513,
    PMActionTrigger: 515,
    PMFieldGroup: 516,
    ActionType: 517,
    RestrictedReference: 519,
    Form: 520,
    FormStatus: 521,
    FormReference: 522,
    FormOwner: 523,
    FormParticipant: 524,
    FormAction: 525,
    FormEmail: 526,
    FormSummary: 530,
    FormHistory: 531,
    ArchivedAccountGroup: 538,
    ArchivedCommissionItemSplit: 539,
    ArchivedFormParticipant: 540,
    ArchivedFormOwner: 541,
    ArchivedFormStaffReferenced: 542,
    ArchivedCustomer: 543,
    ArchivedAccount: 544,
    ArchivedCommisionItem: 545,
    ArchivedRep: 546,
    ArchivedAgency: 547,
    ArchivedSupplier: 548,
    ArchivedProduct: 549,
    StatusTrigger: 550,
    Approval: 560,
    ApprovalStage: 561,
    ProcessFlow: 565,
    FormVerifiedList: 574,
    Holder: 580,
    HolderModifiedDate: 581, // for view
    HolderFiles: 582, // for view
    NoHolderFiles: 583, // for view
    Role: 600,
    AgencyAssignment: 620,
    AgencyAssignmentCategory: 621,
    CalendarAction: 650,
    CalendarDate: 651,
    Cview: 700,
    Cview_ColumnOption: 710,
    Cview_FilterOption: 711,
    AgencyReferral: 715,
    Referral: 716,
    CustomFormReport: 741,
    PhoneType: 800,
    TemporaryLogo: 851,
    Reconciles: 900,
    Reconcile: 901,
    StaticField: 9999,  // Refers to fields like Customer.Website or Contact.FirstName.  Some static fields are shared fields.
    NetBilledForRun: 10000,
    PayoutForRun: 10001,
    GrossCommForRun: 10002,
    GrossProfitForRun: 10003,
    Wholesale: 10004,
    Margin: 10005,
    AgentComm: 10006,
    ContractValue: 10007,
    CommReferralTo: 10008,
    AgencyPayout: 10017,
    CommReferral: 10022,
    Origin: 10040,
    Access: 10041,
    Enabled: 10042,
    Email: 10050,
    FormNumber: 10060,
    BusinessPhone: 10070,
    HomePhone: 10071,
    FaxPhone: 10072,
    OtherPhone: 10073,
    Website: 10074,
    CountryAddress: 10075,
    Modified: 10076,
    Company: 10077,
    PrimaryContact: 10100,
    ContactInfo: 10101,
    StreetAddress: 10102,
    City: 10103,
    StateAddress: 10104,
    ZipCode: 10105,
    Added: 10106,
    Title: 10107,
    RepType: 10108,
    Phone: 10109,
    Latitude: 10110,
    FirstName: 10112,
    LastName: 10113,
    Rename_Reps: 10121,
    Rename_Rep: 10120,
    Rename_Managers: 10122,
    Rename_Manager: 10123,
    Rename_Agency: 10124,
    Rename_Agencies: 10125,
    BardCode: 10200,
    FormStarted: 10201,
    Owner: 10202,
    SelectForm: 10300,
    ShellViewProcess: 10400,
    ShellProcessSingle: 10401,
    ShellAgencyView: 10402,
    ShellAgencySingle: 10403,
    ShellRepView: 10404,
    ShellRepSingle: 10405,
    ShellCustomerView: 10406,
    ShellCustomerSingle: 10407,
    ShellAccountView: 10408,
    ShellAccountSingle: 10409,
    ShellCommItemView: 10410,
    ShellCommItemSingle: 10411,
    ShellStaffView: 10412,
    ShellStaffSingle: 10413,
    NotesForStaff: 10500,
    NotesForAgents: 10501,
    HomePage: 10550,
    ProcessHolder: 10551,
    HolderFlow: 10607,
    HolderFileAttachment: 10608,
    HolderProcess: 10600

};

exports.MeasurementUnit = {
    NA: { value: 0, text: '' },
    Millimeters: { value: 1, text: 'mm', subType: FieldSubType.MeasureLengthSmall },
    Centimeters: { value: 2, text: 'cm', subType: FieldSubType.MeasureLengthSmall },
    Inches: { value: 3, text: 'in', subType: FieldSubType.MeasureLengthSmall },
    Meters: { value: 4, text: 'm', subType: FieldSubType.MeasureLengthMedium },
    Feet: { value: 5, text: 'ft', subType: FieldSubType.MeasureLengthMedium },
    Kilometers: { value: 33, text: 'km', subType: FieldSubType.MeasureLengthLarge },
    Miles: { value: 34, text: 'mi', subType: FieldSubType.MeasureLengthLarge },
    kPa: { value: 6, text: 'kPa', subType: FieldSubType.MeasurePressure },
    psi: { value: 7, text: 'psi', subType: FieldSubType.MeasurePressure },
    SqMillimeter: { value: 8, text: 'mm²', subType: FieldSubType.MeasureArea },
    SqCentimeter: { value: 9, text: 'cm²', subType: FieldSubType.MeasureArea },
    SqInches: { value: 10, text: 'in²', subType: FieldSubType.MeasureArea },
    kg: { value: 11, text: 'kg', subType: FieldSubType.MeasureWeight },
    lbs: { value: 12, text: 'lbs', subType: FieldSubType.MeasureWeight },
    kdaN: { value: 13, text: 'kdaN', subType: FieldSubType.MeasureForce },
    lbf: { value: 14, text: 'lbf', subType: FieldSubType.MeasureForce },
    KGPerCubicMeters: { value: 15, text: 'kg/m³', subType: FieldSubType.MeasureDensity },
    lbsPerGallon: { value: 16, text: 'lb/gal', subType: FieldSubType.MeasureDensity },
    CubicMetersPerMinute: { value: 17, text: 'm³/min', subType: FieldSubType.MeasureFlow },
    GallonsPerMinute: { value: 18, text: 'gal/min', subType: FieldSubType.MeasureFlow },
    Celsius: { value: 19, text: '°C', subType: FieldSubType.MeasureTemperature },
    Fahrenheit: { value: 20, text: '°F', subType: FieldSubType.MeasureTemperature },
    CubicCentimeters: { value: 21, text: 'cm³', subType: FieldSubType.MeasureVolumeSmall },
    Milliliters: { value: 22, text: 'ml', subType: FieldSubType.MeasureVolumeSmall },
    CubicInches: { value: 23, text: 'in³', subType: FieldSubType.MeasureVolumeSmall },
    UsOz: { value: 24, text: 'oz US', subType: FieldSubType.MeasureVolumeSmall },
    CubicMeters: { value: 25, text: 'm³', subType: FieldSubType.MeasureVolumeMedium },
    Litres: { value: 26, text: 'L', subType: FieldSubType.MeasureVolumeMedium },
    CubicFeet: { value: 27, text: 'ft³', subType: FieldSubType.MeasureVolumeMedium },
    USGallon: { value: 28, text: 'gal US', subType: FieldSubType.MeasureVolumeMedium },
    USBBL: { value: 29, text: 'bbl US', subType: FieldSubType.MeasureVolumeMedium },
    MegaCubicMeters: { value: 30, text: '10³m³', subType: FieldSubType.MeasureVolumeLarge },
    MegaLitres: { value: 31, text: 'ML', subType: FieldSubType.MeasureVolumeLarge },
    MegaCubicFeet: { value: 32, text: 'Mcf', subType: FieldSubType.MeasureVolumeLarge },
};

const ProcessPermission = exports.ProcessPermission = {
    NA: 0,
    HideAll: 1,
    Edit: 3,
    EditOwnHideOthers: 8,
    ReadOwnHideOthers: 10,
    ReadAll: 11,
    Start: 12,
    StartOwnHideOthers: 13,
    EditOwnReadOthers: 14,
    StartOwnReadOthers: 15,
    StartHideAll: 17
};

exports.ProcessPermissionsHidden = ['NA', 'HideAll'].map(p => getEager(ProcessPermission, p));

exports.RepTypes = ['Rep', 'Manager'];

exports.FieldFormat = {
    String: 1,    // Account, Role, Supplier, [list field]
    Money: 2,    // Net billed, Payout, [money 2], [money 4], [formula 2], [formula 4]
    Date: 3,    // Action due, Last logon, [date field]
    Boolean: 4,    // Yes/no, [yesno field]
    Integer: 5,    // Number of accounts, Files, Qty
    Percent: 6,    // Decimal percent, like 0.5 for 50%
    Text: 7,    // [text field], [description field], [list multi-select]
    Email: 8,    // Email (from contacts)
    Phone: 9,    // Phone (from contacts)
    View: 10,   // View link column - or other "controls" that are links
    SmallText: 11,   // Special text
    Http: 12,   // Website from company, [link field], [link (fixed)]. Value is a URL like http://google.com
    Divider: 13,   // [divider field]
    Misc: 14,   // ? phone + email?
    BigInt: 15,   // NOT USED
    TextArea: 16,   // Paragraph, [text area field]
    IntegerLink: 17,   // Items link
    Table: 18,   // [table field]
    Number: 20,   // [number field], [number (fixed)]
    PercentCustom: 21,   // "whole number", like 50 for 50% [percent field] 
    SpecialPhone: 22,   // [npa-nxxx]
    LocationLatLong: 23,   // [lat/long]
    GoogleMapLink: 24,   // Map column
    DateTime: 25,   // A formatted Date and time string
    Money4: 26,   // 4 decimal money type
    TimeDate: 27,   // A Time and date in the format (3:39 PM Aug 30, 2010)
    YMAsDate: 28,   // The underlying data is a YM string that needs to be formatted as a date.
    NumberDouble: 29,   // A decimal number type.
    IntegerRaw: 30,   // A format that corresponds to the integer digits and nothing else (no commas).
    General: 31,   // For Excel, this equates with "No formatting".  This is needed for situations where we would use Text, but there are many return feeds which causes the cell not to display properly (Case 5069)
    Label: 32,   // Label Custom field.  Used (so far) for multi-form printing.
    Description: 33,   // Description Custom field.  Used (so far) for multi-form printing.
    DateTimeFormatted: 34,   // A DateTime that is ready for display. compared to 25 which is really like a "DateTimeRaw"
    LinkEl: 35,   // Contains a link element in html
    RpmObjLink: 36,   // Not used yet, but will have a way to have type id, obj id, and name given and JS will make the link 
    RpmObjLinkSubtle: 37,   // Above but only show link on hover (give the anchor element css class="gridLink")
    DateTimeISOShort: 38,   // An ISO date format:  [YYYY]-[MM]-[DD]T[hh]:[mm]
    LocationDLS: 39,   // A DLS location
    LocationNTS: 40,   // A NTS
    LocationUTM: 41,   // A UTM
    WellUWI: 42,   // A Well UWI
    WellAPI: 43,   // A Well API
    DescriptionTable: 44,   // A description table decoration field.
    WellColumn: 45,   // A Well Data
    MeasurementField: 46,   // One of the measurement fields: 1:11 is "11 mm"
    YesNoList: 47    // A YesNo field list
};

exports.StaticViewColumnUids = {
    AgencyID: '710_636',
    FormID: '710_639',
    Archived: '710_235',
    Agency: '710_152',
    FormNumber: '710_34'
};
