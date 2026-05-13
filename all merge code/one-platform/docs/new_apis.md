# New Car APIs

These APIs were added without changing the previous car workflow.

Existing routes like `GET /api/listings`, `GET /api/listing/{id}`, `GET /api/pricing-calendar`, `POST /api/simulate`, and admin pricing controls continue to work as before.

## 1. Listings Search, Pagination, Filters

### `GET /api/listings/query`

Additive endpoint for searchable, paginated, filterable listings.

### Query params

- `search`
- `page` (default `1`)
- `pageSize` (default `20`, max `100`)
- `city`
- `country`
- `group`
- `supplierName`
- `minPrice`
- `maxPrice`
- `approvalStatus` (`pending`, `approved`, `rejected`)
- `sortBy` (`title`, `city`, `country`, `group`, `supplierName`, `avgPrice`, `revenue`, `occupancyRate`, `approvalStatus`)
- `sortOrder` (`asc`, `desc`)

### Example

```http
GET /api/listings/query?search=london&page=1&pageSize=10&group=Economy&approvalStatus=approved&sortBy=avgPrice&sortOrder=asc
```

### Response shape

```json
{
  "items": [
    {
      "id": "lst_9502866c86862693",
      "title": "Kia Ceed",
      "location": "London",
      "city": "London",
      "country": "GB",
      "group": "Economy",
      "supplier_name": "Green Motion",
      "revenue": 1234.5,
      "occupancyRate": 0.45,
      "avgPrice": 89.5,
      "currency": "GBP",
      "approvalStatus": "approved",
      "approvalReason": "Reviewed by admin",
      "reviewedBy": "tester",
      "reviewedAt": "2026-05-13T06:25:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 100,
    "totalPages": 10,
    "hasNext": true,
    "hasPrevious": false
  },
  "filtersApplied": {
    "search": "london",
    "city": null,
    "country": null,
    "group": "Economy",
    "supplierName": null,
    "minPrice": null,
    "maxPrice": null,
    "approvalStatus": "approved",
    "sortBy": "avgPrice",
    "sortOrder": "asc"
  }
}
```

### `GET /api/listings/filter-options`

Returns filter metadata for dropdowns.

### Response

```json
{
  "cities": ["London", "Manchester"],
  "countries": ["GB"],
  "groups": ["Economy", "Compact"],
  "suppliers": ["Green Motion", "Hertz"],
  "approvalStatuses": ["pending", "approved", "rejected"]
}
```

### `GET /api/listings/export`

Exports filtered listings.

### Query params

Same filters as `/api/listings/query`, plus:

- `format=csv|json` (default `csv`)

### Example

```http
GET /api/listings/export?search=london&approvalStatus=approved&format=csv
```

## 2. Simulation Data API

### `GET /api/simulation-data`

Provides preloaded data for the simulation page.

### Query params

- `listingId` (optional; if omitted, first listing is used)

### Response

```json
{
  "listingId": "lst_9502866c86862693",
  "listing": {
    "id": "lst_9502866c86862693",
    "title": "Kia Ceed",
    "city": "London",
    "country": "GB",
    "group": "Economy",
    "approvalStatus": "pending"
  },
  "defaults": {
    "city": "London",
    "country": "GB",
    "group": "Economy",
    "startDate": "2026-05-20",
    "returnDate": "2026-05-27",
    "minPriceGbp": 70,
    "maxPriceGbp": 180,
    "stepGbp": 5,
    "windowPct": 0.5
  },
  "settings": {
    "minPrice": 60,
    "maxPrice": 180,
    "smartPricingEnabled": true,
    "discounts": {
      "weekly": 10,
      "monthly": 20
    }
  },
  "pricingTryValues": {
    "minPrice": 70,
    "maxPrice": 180
  },
  "recentDemand": [],
  "availableListings": []
}
```

## 3. Dashboard Export API

### `GET /api/dashboard/export`

Exports dashboard data in sections.

### Query params

- `section=summary|listings|demand` (default `summary`)
- `format=csv|json` (default `csv`)
- `listingId` (used for `section=demand`; optional fallback to first listing)

### Examples

```http
GET /api/dashboard/export?section=summary&format=json
GET /api/dashboard/export?section=listings&format=csv
GET /api/dashboard/export?section=demand&listingId=lst_9502866c86862693&format=json
```

## 4. Admin Car Approval APIs

Vacation Rentals-style moderation flow for cars:

- `pending`
- `approved`
- `rejected`

### `GET /api/admin/cars/review`

Lists cars for admin review.

### Query params

- `status`
- `search`
- `page`
- `pageSize`

### Example

```http
GET /api/admin/cars/review?status=pending&page=1&pageSize=20
```

### `POST /api/admin/cars/{listing_id}/approve`

Approves a car/listing.

### Request body

```json
{
  "reason": "Looks good",
  "reviewedBy": "admin_user"
}
```

### `POST /api/admin/cars/{listing_id}/reject`

Rejects a car/listing.

### Request body

```json
{
  "reason": "Missing required fields",
  "reviewedBy": "admin_user"
}
```

### Approval response shape

```json
{
  "ok": true,
  "listingId": "lst_9502866c86862693",
  "approvalStatus": "approved",
  "approvalReason": "Looks good",
  "reviewedBy": "admin_user",
  "reviewedAt": "2026-05-13T06:25:00Z"
}
```

## 5. Form Validation Updates

Validation was added in the current car forms without changing their workflow:

- `SimulationPage`
  - required city/country/group
  - valid start/return dates
  - `returnDate >= startDate`
  - positive min/max/step
  - `maxPrice >= minPrice`
  - `windowPct` between `0` and `5`
- `ListingSettingsPage`
  - positive min/max
  - `maxPrice >= minPrice`
  - weekly/monthly discounts between `0` and `100`
- `PricingControlPage`
  - positive min/max
  - `maxPrice >= minPrice`
  - non-empty region for regional override

## Validation Notes

Additional backend validation was also added for:

- quote/simulate date ordering
- optimize min/max bounds
- listing settings min/max and discount range
- region override min/max and blank region
- override price date parsing

## Smoke Test

The new APIs were smoke-tested locally with FastAPI `TestClient`:

- `GET /listings/query` -> `200`
- `GET /listings/filter-options` -> `200`
- `GET /simulation-data` -> `200`
- `GET /dashboard/export?section=summary&format=json` -> `200`
- `GET /admin/cars/review` -> `200`
- `POST /admin/cars/{id}/approve` -> `200`
