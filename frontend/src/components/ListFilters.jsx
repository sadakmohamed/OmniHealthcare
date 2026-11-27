import React, { useState } from 'react'
import { CalendarDays, Search, SlidersHorizontal } from 'lucide-react'

export default function ListFilters({ screen, value, onApply, showSearch = true }) {
  const [search, setSearch] = useState(value.search || '')
  const [date, setDate] = useState(value.date || '')

  function apply(event) {
    event.preventDefault()
    onApply({
      search: showSearch ? search.trim() : '',
      date
    })
  }

  return (
    <form className="global-list-filters" onSubmit={apply} aria-label={`${screen} list filters`}>
      {showSearch && (
        <label className="toolbar-search">
          <Search size={16} />
          <input
            type="search"
            placeholder="Search this list"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      )}
      <label className="global-date-filter">
        <CalendarDays size={15} />
        <input
          type="date"
          aria-label="Filter records by exact date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      <button className="btn btn-secondary btn-sm" type="submit">
        <SlidersHorizontal size={14} /> Apply filters
      </button>
    </form>
  )
}
