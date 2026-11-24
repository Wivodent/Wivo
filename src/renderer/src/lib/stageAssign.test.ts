import { describe, expect, it } from 'vitest'
import { initials, visiblePeople, withPerson, personName, stageFaces, stagePeopleOf } from './stageAssign'

describe('stage people helpers', () => {
  it('initials: first and last name, or the first two letters of one name', () => {
    expect(initials('Anna Maria Tamm')).toBe('AT')
    expect(initials('kristjan')).toBe('KR')
    expect(initials('  ')).toBe('?')
    expect(initials(null)).toBe('?')
    expect(initials('Õie Šmidt')).toBe('ÕŠ')
  })
  it('adds and removes a person without duplicates', () => {
    expect(withPerson(['a'], 'b', true)).toEqual(['a', 'b'])
    expect(withPerson(['a', 'b'], 'a', true)).toEqual(['b', 'a'])
    expect(withPerson(['a', 'b'], 'a', false)).toEqual(['b'])
  })
  it('shows two circles and a count for the rest', () => {
    expect(visiblePeople(['a', 'b'])).toEqual({ shown: ['a', 'b'], more: 0 })
    expect(visiblePeople(['a', 'b', 'c', 'd'])).toEqual({ shown: ['a', 'b'], more: 2 })
  })
})

describe('who the stage bar shows', () => {
  it('a person without a full name: the username, else no name (an icon, never "UN")', () => {
    expect(personName({ full_name: 'Mari Maasikas', username: 'mari' })).toBe('Mari Maasikas')
    expect(personName({ full_name: '  ', username: 'tehnik1' })).toBe('tehnik1')
    expect(personName({ full_name: null, username: null })).toBeNull()
    expect(stagePeopleOf([{ id: 'a', full_name: null }], 'Unnamed')).toEqual([{ id: 'a', name: 'Unnamed', named: false }])
    expect(stagePeopleOf([{ id: 'b', full_name: 'Gary' }], 'Unnamed')).toEqual([{ id: 'b', name: 'Gary', named: true }])
  })

  it('someone no longer in the team is nobody on the stage: such a stage shows "+ person"', () => {
    const team = [{ id: 'a' }, { id: 'b' }]
    expect(stageFaces(['a', 'gone'], team)).toEqual(['a'])
    expect(stageFaces(['gone'], team)).toEqual([])
    // the team not loaded yet: nothing is dropped
    expect(stageFaces(['a', 'gone'], [])).toEqual(['a', 'gone'])
  })
})
