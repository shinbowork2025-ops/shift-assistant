/**
 * @typedef {Object} BreakSegment
 * @property {"small"|"lunch"} type
 * @property {number} duration
 * @property {number} targetOffset
 */

/**
 * @typedef {Object} BreakPolicy
 * @property {number} totalMinutes
 * @property {BreakSegment[]} segments
 */

/**
 * @typedef {Object} BreakPlacement
 * @property {"small"|"lunch"} type
 * @property {string} [label]
 * @property {number} startMinute
 * @property {number} endMinute
 */

/**
 * @typedef {Object} BreakPlacementResult
 * @property {boolean} ok
 * @property {Object<string, BreakPlacement[]>} placements
 * @property {Object[]} unplacedSegments
 * @property {Object} finalCoverage
 * @property {number} finalShortagePersonSlots
 * @property {Object<string, number>} finalShortageByScope
 * @property {Object} statistics
 */

/**
 * @typedef {Object} ShiftType
 * @property {string} code
 * @property {string} name
 * @property {boolean} isDayOff
 * @property {number} [startMinutes]
 * @property {number} [endMinutes]
 * @property {boolean} [isLateShift]
 * @property {number} [overtimeMinutes]
 * @property {number} [paidMinutes]
 * @property {BreakPolicy} [breakPolicy]
 */

/**
 * @typedef {Object} Employee
 * @property {string} id
 * @property {string} name
 * @property {string} [employmentType]
 * @property {string} [department]
 * @property {string[]} [qualifications]
 * @property {number} [fixedOvertimeMinutes]
 * @property {number} [targetDaysOff]
 */

/**
 * @typedef {Object} CoverageRequirement
 * @property {number[]} days 期間内の0始まり日インデックス
 * @property {number} startSlot このスロットを含む
 * @property {number} endSlot このスロットを含まない
 * @property {{type:"total"|"qualification"|"department"|"employmentType", key?:string}} scope
 * @property {number} count
 */

/**
 * @typedef {Object} PreferenceRequest
 * @property {string} employeeId
 * @property {number} day
 * @property {"dayOff"|"shift"} kind
 * @property {string} [shiftCode]
 */

/**
 * @typedef {Object} WorkspaceSettings
 * @property {"weekly"|"fourWeek"|"disabled"} statutoryHolidayRule
 * @property {number} [weekStartDay]
 * @property {string} [fourWeekCycleStartDate]
 * @property {string[]} statutoryHolidayCodes
 * @property {boolean} previousBoundaryKnown
 * @property {boolean} nextBoundaryKnown
 * @property {number} restMinimumMinutes
 * @property {number} maxConsecutiveWorkDays
 * @property {Object} breakConstraints
 * @property {Object} weights normalizeSolverWeights済みの重み
 */

/**
 * @typedef {Object} Plan
 * @property {string} periodStart
 * @property {number} dayCount
 * @property {string[]} employeeOrder
 * @property {(string|null)[][]} assignments
 * @property {Set<string>} lockedCells
 */

/**
 * @typedef {Object} ViolationDetail
 * @property {"statutory"|"internal"|"preference"} layer
 * @property {"statutoryHolidayDeficit"|"restDeficit"|"consecutiveExcess"|"daysOffDeviation"|"missedDayOffRequest"|"missedShiftRequest"} type
 * @property {string} [employeeId]
 * @property {number[]} days
 * @property {number} amount 日、15分単位数、超過日数、差日数のいずれか
 * @property {string} message
 */

/**
 * @typedef {Object} VerificationIssue
 * @property {"prevBoundaryUnknown:consecutive"|"prevBoundaryUnknown:restInterval"|"nextBoundaryUnknown:consecutive"|"nextBoundaryUnknown:restInterval"|"statutoryCycleIncomplete"} type
 * @property {string} [employeeId]
 * @property {string} message
 */

/**
 * @typedef {Object} EvaluationResult
 * @property {number} solverConfigVersion
 * @property {number} score
 * @property {number} statutoryPenalty
 * @property {number} internalPenalty
 * @property {number} coveragePenalty
 * @property {number} overtimePenalty
 * @property {number} preferencePenalty
 * @property {number} fairnessPenalty
 * @property {number} changePenalty
 * @property {number} statutoryViolationCount
 * @property {number} statutoryViolationAmount
 * @property {number} internalViolationCount
 * @property {number} internalViolationAmount
 * @property {number} preferenceViolationCount
 * @property {number} preferenceViolationAmount
 * @property {{statutory:Object, internal:Object, preference:Object}} constraintLayers
 * @property {number} estimatedShortagePersonSlots
 * @property {Object<string, number>} estimatedShortageByScope
 * @property {Object[]} violations
 * @property {Object[]} verificationIssues
 * @property {Object} breakdownByEmployee
 */

export const EVALUATION_TYPE_VERSION = 1;
