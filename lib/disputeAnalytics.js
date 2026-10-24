// Dispute analytics aggregation for the admin dashboard (Member B).
// One round trip using $facet; each facet answers one dashboard question.

export function disputeAnalyticsPipeline({ from, to } = {}) {
  const match = {};
  if (from || to) {
    match.created_at = {};
    if (from) match.created_at.$gte = from;
    if (to) match.created_at.$lt = to;
  }

  return [
    { $match: match },
    {
      $facet: {
        // How many cases are open / under review / resolved.
        byStatus: [
          { $group: { _id: '$status', count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ],

        // Most common reasons, with how many are still unresolved.
        byReason: [
          {
            $group: {
              _id: '$reason',
              total: { $sum: 1 },
              unresolved: { $sum: { $cond: [{ $ne: ['$status', 'resolved'] }, 1, 0] } },
            },
          },
          { $sort: { total: -1 } },
        ],

        // Resolved cases: release vs refund split and average hours to resolve.
        outcomes: [
          { $match: { status: 'resolved' } },
          {
            $group: {
              _id: '$resolution.decision',
              count: { $sum: 1 },
              avgHoursToResolve: {
                $avg: {
                  $dateDiff: { startDate: '$created_at', endDate: '$resolution.resolved_at', unit: 'minute' },
                },
              },
            },
          },
          { $project: { count: 1, avgHoursToResolve: { $round: [{ $divide: ['$avgHoursToResolve', 60] }, 1] } } },
          { $sort: { _id: 1 } },
        ],

        // New disputes per day, for a trend chart.
        perDay: [
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: 'Asia/Kolkata' } },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],

        // Users who have had the most disputes raised against them.
        mostDisputedUsers: [
          { $group: { _id: '$against', disputes: { $sum: 1 } } },
          { $match: { disputes: { $gte: 2 } } },
          { $sort: { disputes: -1 } },
          { $limit: 5 },
        ],

        // Evidence and message activity per case.
        engagement: [
          {
            $group: {
              _id: null,
              cases: { $sum: 1 },
              avgEvidence: { $avg: { $size: '$evidence' } },
              avgMessages: { $avg: { $size: '$messages' } },
            },
          },
          { $project: { _id: 0, cases: 1, avgEvidence: { $round: ['$avgEvidence', 1] }, avgMessages: { $round: ['$avgMessages', 1] } } },
        ],
      },
    },
  ];
}

export async function getDisputeAnalytics(db, range) {
  const [result] = await db.collection('dispute_cases').aggregate(disputeAnalyticsPipeline(range)).toArray();
  return result;
}
