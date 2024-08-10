export default async (req, res) => {
  // Simulate a long-running process (e.g., 10 seconds)

  const randomTimeout = Math.floor(Math.random() * 10000) + 10000
  await new Promise((resolve) => setTimeout(resolve, randomTimeout))

  // Return data after the process is completed

  return res.json({
    success: randomTimeout > 15000 ? false : true,
    message: 'Process completed successfully',
    result: { data: 'some_processed_data', msToResponse: randomTimeout },
  })
}
