const { Schema, model } = require('mongoose');

const assignmentSchema = new mongoose.Schema({
  // schema fields
}, { collection: 'assignmentpassdatas' });

module.exports = mongoose.model('AssignmentPassData', assignmentSchema);
