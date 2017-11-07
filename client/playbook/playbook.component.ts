import { Component, ViewEncapsulation, ViewChild, ElementRef } from '@angular/core';
// import * as _ from 'lodash';
import { Observable } from 'rxjs';
import { ToastyService, ToastyConfig } from 'ng2-toasty';
import { UUID } from 'angular2-uuid';

import { PlaybookService } from './playbook.service';
import { AuthService } from '../auth/auth.service';

import { AppApi } from '../models/api/appApi';
import { ActionApi } from '../models/api/actionApi';
import { ParameterApi } from '../models/api/parameterApi';
import { ConditionApi } from '../models/api/conditionApi';
import { TransformApi } from '../models/api/transformApi';
import { DeviceApi } from '../models/api/deviceApi';
import { ReturnApi } from '../models/api/returnApi';
import { Playbook } from '../models/playbook/playbook';
import { Workflow } from '../models/playbook/workflow';
import { Step } from '../models/playbook/step';
import { NextStep } from '../models/playbook/nextStep';
import { GraphPosition } from '../models/playbook/graphPosition';
import { Device } from '../models/device';
import { Argument } from '../models/playbook/argument';
import { WorkflowResult } from '../models/playbook/workflowResult';

@Component({
	selector: 'playbook-component',
	templateUrl: 'client/playbook/playbook.html',
	styleUrls: [
		'client/playbook/playbook.css',
	],
	encapsulation: ViewEncapsulation.None,
	providers: [PlaybookService, AuthService],
})
export class PlaybookComponent {
	@ViewChild('cyRef') cyRef: ElementRef;

	devices: Device[] = [];
	relevantDevices: Device[] = [];

	currentPlaybook: string;
	currentWorkflow: string;
	loadedWorkflow: Workflow;
	playbooks: Playbook[] = [];
	cy: any;
	ur: any;
	appApis: AppApi[] = [];
	offset: GraphPosition = { x: -330, y: -170 };
	selectedStep: Step; // node being displayed in json editor
	selectedNextStepParams: {
		nextStep: NextStep;
		returnTypes: ReturnApi[];
		app: string;
		action: string;
	};
	cyJsonData: string;
	workflowResults: WorkflowResult[] = [];

	// Simple bootstrap modal params
	modalParams: {
		title: string,
		submitText: string,
		shouldShowPlaybook?: boolean,
		shouldShowExistingPlaybooks?: boolean,
		selectedPlaybook?: string,
		newPlaybook?: string,
		shouldShowWorkflow?: boolean,
		newWorkflow?: string,
		submit: () => any,
	} = {
		title: '',
		submitText: '',
		shouldShowPlaybook: false,
		shouldShowExistingPlaybooks: false,
		selectedPlaybook: '',
		newPlaybook: '',
		shouldShowWorkflow: false,
		newWorkflow: '',
		submit: (() => null) as () => any,
	};

	constructor(
		private playbookService: PlaybookService, private authService: AuthService,
		private toastyService: ToastyService, private toastyConfig: ToastyConfig) {
		this.toastyConfig.theme = 'bootstrap';

		this.playbookService.getDevices().then(devices => this.devices = devices);
		this.playbookService.getApis().then(appApis => this.appApis = appApis.sort((a, b) => a.name > b.name ? 1 : -1));
		this.getWorkflowResultsSSE();
		this.getPlaybooksWithWorkflows();
		this._addCytoscapeEventBindings();
	}

	///------------------------------------------------------------------------------------------------------
	/// Playbook CRUD etc functions
	///------------------------------------------------------------------------------------------------------
	/**
	 * Sets up the EventStream for receiving stream steps from the server.
	 * Will currently return ALL stream steps and not just the ones manually executed.
	 */
	getWorkflowResultsSSE(): void {
		this.authService.getAccessTokenRefreshed()
			.then(authToken => {
				const observable = Observable.create((observer: any) => {
					const eventSource = new (window as any).EventSource('workflowresults/stream-steps?access_token=' + authToken);
					eventSource.onmessage = (x: object) => observer.next(x);
					eventSource.onerror = (x: Error) => observer.error(x);

					return () => {
						eventSource.close();
					};
				});

				observable.subscribe({
					next: (workflowResult: WorkflowResult) => {
						const matchingNode = this.cy.elements(`node[uid="${workflowResult.step_uid}"]`);

						if (workflowResult.type === 'SUCCESS') {
							matchingNode.addClass('good-highlighted');
						} else { matchingNode.addClass('bad-highlighted'); }

						this.workflowResults.push(workflowResult);
					},
					error: (err: Error) => {
						this.toastyService.error(`Error retrieving workflow results: ${err.message}`);
						console.error(err);
					},
				});
			});
	}

	/**
	 * Executes the loaded workflow as it exists on the server. Will not currently execute the workflow as it stands.
	 */
	executeWorkflow(): void {
		this.playbookService.executeWorkflow(this.currentPlaybook, this.currentWorkflow)
			.then(() => this.toastyService.success(`Starting execution of ${this.currentPlaybook} - ${this.currentWorkflow}.`))
			.catch(e => this.toastyService
				.error(`Error starting execution of ${this.currentPlaybook} - ${this.currentWorkflow}: ${e.message}`));
	}

	/**
	 * Loads a workflow from a given playbook / workflow name pair.
	 * Configures the cytoscape graph and binds cytoscape events.
	 * @param playbookName Playbook to load
	 * @param workflowName Workflow to load
	 */
	loadWorkflow(playbookName: string, workflowName: string): void {
		const self = this;

		this.playbookService.loadWorkflow(playbookName, workflowName)
			.then(workflow => {
				this.currentPlaybook = playbookName;
				this.currentWorkflow = workflowName;
				this.loadedWorkflow = workflow;

				// Convert our selector arrays to a string
				this.loadedWorkflow.steps.forEach(s => {
					s.inputs.forEach(i => {
						if (i.selector && Array.isArray(i.selector)) { i.selector = (i.selector as Array<string | number>).join('.'); }
					});
				});

				// Create the Cytoscape graph
				this.cy = cytoscape({
					container: document.getElementById('cy'),
					boxSelectionEnabled: false,
					autounselectify: false,
					wheelSensitivity: 0.1,
					layout: { name: 'preset' },
					style: [
						{
							selector: 'node',
							css: {
								'content': 'data(label)',
								'text-valign': 'center',
								'text-halign': 'center',
								'shape': 'roundrectangle',
								'background-color': '#bbb',
								'selection-box-color': 'red',
								'font-family': 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif, sans-serif',
								'font-weight': 'lighter',
								'font-size': '15px',
								'width': '40',
								'height': '40',
							},
						},
						{
							selector: 'node[type="action"]',
							css: {
								'background-color': '#bbb',
							},
						},
						{
							selector: 'node[type="eventAction"]',
							css: {
								'shape': 'star',
								'background-color': '#edbd21',
							},
						},
						{
							selector: 'node[?isStartNode]',
							css: {
								'border-width': '2px',
								'border-color': '#991818',
							},
						},
						{
							selector: 'node:selected',
							css: {
								'background-color': '#77b0d0',
							},
						},
						{
							selector: '.good-highlighted',
							css: {
								'background-color': '#399645',
								'transition-property': 'background-color',
								'transition-duration': '0.5s',
							},
						},
						{
							selector: '.bad-highlighted',
							css: {
								'background-color': '#8e3530',
								'transition-property': 'background-color',
								'transition-duration': '0.5s',
							},
						},
						{
							selector: '$node > node',
							css: {
								'padding-top': '10px',
								'padding-left': '10px',
								'padding-bottom': '10px',
								'padding-right': '10px',
								'text-valign': 'top',
								'text-halign': 'center',
							},
						},
						{
							selector: 'edge',
							css: {
								'target-arrow-shape': 'triangle',
								'curve-style': 'bezier',
							},
						},
					],
				});

				// Enable various Cytoscape extensions
				// Undo/Redo extension
				this.ur = this.cy.undoRedo({});

				// Panzoom extension
				this.cy.panzoom({});

				// Extension for drawing edges
				this.cy.edgehandles({
					preview: false,
					toggleOffOnLeave: true,
					complete (sourceNode: any, targetNodes: any[], addedEntities: any[]) {
						if (!self.loadedWorkflow.next_steps) { self.loadedWorkflow.next_steps = []; }

						// The edge handles extension is not integrated into the undo/redo extension.
						// So in order that adding edges is contained in the undo stack,
						// remove the edge just added and add back in again using the undo/redo
						// extension. Also add info to edge which is displayed when user clicks on it.
						for (let i = 0; i < targetNodes.length; i++) {
							// Get the ID from the added node and use it; uses the same UUID method seemingluy
							const uid: string = addedEntities[i].data('id');
							const sourceUid: string = sourceNode.data('uid');
							const destinationUid = targetNodes[i].data('uid');

							addedEntities[i].data({
								uid,
								// We set temp because this actually triggers onEdgeRemove since we manually remove and re-add the edge later
								// There is logic in onEdgeRemove to bypass that logic if temp is true
								temp: true,
							});

							//If we attempt to draw an edge that already exists, please remove it and take no further action
							if (self.loadedWorkflow.next_steps
								.find(ns =>  ns.source_uid === sourceUid && ns.destination_uid === destinationUid)) {
								self.cy.remove(addedEntities);
								return;
							}

							// Add our next step to the actual loadedWorkflow model
							self.loadedWorkflow.next_steps.push({
								uid,
								source_uid: sourceUid,
								destination_uid: destinationUid,
								status: 'Success',
								priority: 1,
								conditions: [],
							});
						}

						self.cy.remove(addedEntities);

						// Get rid of our temp flag
						addedEntities.forEach(ae => ae.data('temp', false));

						// Re-add with the undo-redo extension.
						self.ur.do('add', addedEntities); // Added back in using undo/redo extension
					},
				});

				// Extension for copy and paste
				this.cy.clipboard();

				//Extension for grid and guidelines
				this.cy.gridGuide({
					snapToGridDuringDrag: true,
					zoomDash: true,
					panGrid: true,
					centerToEdgeAlignment: true,
					distributionGuidelines: true, // Distribution guidelines
					geometricGuideline: true, // Geometric guidelines
					// Guidelines
					guidelinesStackOrder: 4, // z-index of guidelines
					guidelinesTolerance: 2.00, // Tolerance distance for rendered positions of nodes' interaction.
					guidelinesStyle: { // Set ctx properties of line. Properties are here:
						strokeStyle: '#8b7d6b', // color of geometric guidelines
						geometricGuidelineRange: 400, // range of geometric guidelines
						range: 100, // max range of distribution guidelines
						minDistRange: 10, // min range for distribution guidelines
						distGuidelineOffset: 10, // shift amount of distribution guidelines
						horizontalDistColor: '#ff0000', // color of horizontal distribution alignment
						verticalDistColor: '#00ff00', // color of vertical distribution alignment
						initPosAlignmentColor: '#0000ff', // color of alignment to initial mouse location
						lineDash: [0, 0], // line style of geometric guidelines
						horizontalDistLine: [0, 0], // line style of horizontal distribution guidelines
						verticalDistLine: [0, 0], // line style of vertical distribution guidelines
						initPosAlignmentLine: [0, 0], // line style of alignment to initial mouse position
					},
				});

				// Load the data into the graph
				// If a node does not have a label field, set it to
				// the action. The label is what is displayed in the graph.
				const edges = workflow.next_steps.map(nextStep => {
					const edge: any = { group: 'edges' };
					edge.data = {
						id: nextStep.uid,
						uid: nextStep.uid,
						source: nextStep.source_uid,
						target: nextStep.destination_uid,
					};
					return edge;
				});
	
				const nodes = workflow.steps.map(step => {
					const node: any = { group: 'nodes', position: _.clone(step.position) };
					node.data = {
						id: step.uid,
						uid: step.uid,
						label: step.name, 
						isStartNode: step.uid === workflow.start,
					};
					self._setNodeDisplayProperties(node, step);
					return node;
				});

				this.cy.add(nodes.concat(edges));

				this.cy.fit(null, 50);

				this.setStartNode(workflow.start);

				// Configure handler when user clicks on node or edge
				this.cy.on('select', 'node', (e: any) => this.onNodeSelect(e, this));
				this.cy.on('select', 'edge', (e: any) => this.onEdgeSelect(e, this));
				this.cy.on('unselect', (e: any) => this.onUnselect(e, this));

				// Configure handlers when nodes/edges are added or removed
				this.cy.on('add', 'node', (e: any) => this.onNodeAdded(e, this));
				this.cy.on('remove', 'node', (e: any) => this.onNodeRemoved(e, this));
				this.cy.on('remove', 'edge', (e: any) => this.onEdgeRemove(e, this));

				this.cyJsonData = JSON.stringify(workflow, null, 2);

				this._closeWorkflowsModal();
			})
			.catch(e => this.toastyService.error(`Error loading workflow ${playbookName} - ${workflowName}: ${e.message}`));
	}

	/**
	 * Closes the active workflow and clears all relevant variables.
	 */
	closeWorkflow(): void {
		this.currentPlaybook = '';
		this.currentWorkflow = '';
		this.loadedWorkflow = null;
		this.selectedNextStepParams = null;
		this.selectedStep = null;
	}

	/**
	 * Triggers the save action based on the editor option selected.
	 */
	save(): void {
		// if ($('.nav-tabs .active').text() === 'Graphical Editor') {
		// 	// If the graphical editor tab is active
		// 	this.saveWorkflow(this.cy.elements().jsons());
		// }
		// else {
		// 	// If the JSON tab is active
		// 	this.saveWorkflowJson(this.cyJsonData);
		// }
		this.saveWorkflow(this.cy.elements().jsons());
	}

	/**
	 * Saves the workflow loaded in the editor.
	 * Updates the graph positions from the cytoscape model and sanitizes data beforehand.
	 * @param cyData Nodes and edges from the cytoscape graph. Only really used to grab the new positions of nodes.
	 */
	saveWorkflow(cyData: any[]): void {
		if (!this.loadedWorkflow.start) {
			this.toastyService.warning('Workflow cannot be saved without a starting step.');
			return;
		}

		// Go through our workflow and update some parameters
		this.loadedWorkflow.steps.forEach(s => {
			// Set the new cytoscape positions on our loadedworkflow
			s.position = cyData.find(cyStep => cyStep.data.uid === s.uid).position;
			
			// Properly sanitize arguments through the tree
			s.inputs.forEach(i => this._sanitizeArgumentForSave(i));

			s.triggers.forEach(t => {
				t.args.forEach(a => this._sanitizeArgumentForSave(a));

				t.transforms.forEach(tr => {
					tr.args.forEach(a => this._sanitizeArgumentForSave(a));
				});
			});
		});
		this.loadedWorkflow.next_steps.forEach(ns => {
			ns.conditions.forEach(c => {
				c.args.forEach(a => this._sanitizeArgumentForSave(a));

				c.transforms.forEach(tr => {
					tr.args.forEach(a => this._sanitizeArgumentForSave(a));
				});
			});
		});

		this.playbookService.saveWorkflow(this.currentPlaybook, this.currentWorkflow, this.loadedWorkflow)
			.then(() => this.toastyService
				.success(`Successfully saved workflow ${this.currentPlaybook} - ${this.currentWorkflow}.`))
			.catch(e => this.toastyService
				.error(`Error saving workflow ${this.currentPlaybook} - ${this.currentWorkflow}: ${e.message}`));
	}

	/**
	 * Saves a workflow from a JSON string instead of using the graphical editor.
	 * @param workflowJSONString The JSON string submitted by the user to be parsed as a workflow object.
	 */
	saveWorkflowJson(workflowJSONString: string): void {
		// // Convert data in string format under JSON tab to a dictionary
		// let dataJson = JSON.parse(workflowJSONString);

		// // Get current list of steps from cytoscape data in JSON format
		// let workflowData = this.cy.elements().jsons();

		// // Track existing steps using a dictionary where the keys are the
		// // step ID and the values are the index of the step in workflowData
		// let ids: { [key: string]: string } = {};
		// for (let step = 0; step < workflowData.length; step++) {
		// 	ids[workflowData[step].data.uid] = step.toString();
		// }

		// // Compare current list of steps with updated list and modify current list
		// let stepsJson = dataJson.steps; // Get updated list of steps
		// stepsJson.forEach(function (stepJson: any) {
		// 	let idJson = stepJson.data.uid;
		// 	if (idJson in ids) {
		// 		// If step already exists, then just update its fields
		// 		let step = Number(ids[idJson])
		// 		workflowData[step].data = stepJson.data;
		// 		workflowData[step].group = stepJson.group;
		// 		workflowData[step].position = stepJson.position;
		// 		// Delete step id
		// 		delete ids[idJson]
		// 	} else {
		// 		// If step is absent, then create a new step
		// 		let newStep = getStepTemplate();
		// 		newStep.data = stepJson.data;
		// 		newStep.group = stepJson.group;
		// 		newStep.position = stepJson.position;
		// 		// Add new step
		// 		workflowData.push(newStep)
		// 	}
		// })

		// if (Object.keys(ids).length > 0) {
		// 	// If steps have been removed, then delete steps
		// 	for (let id in Object.keys(ids)) {
		// 		let step = Number(ids[idJson])
		// 		workflowData.splice(step, 1)
		// 	}
		// }

		// // Save updated cytoscape data in JSON format
		// this.saveWorkflow(workflowData);
	}

	/**
	 * Gets a list of all the loaded playbooks along with their workflows.
	 */
	getPlaybooksWithWorkflows(): void {
		this.playbookService.getPlaybooks()
			.then(playbooks => this.playbooks = playbooks);
	}

	/**
	 * Sanitizes an argument so we don't have bad data on save, such as a value when reference is specified.
	 * @param argument The argument to sanitize
	 */
	_sanitizeArgumentForSave(argument: Argument): void {
		if (argument.reference) { argument.value = undefined; }

		// Split our string argument selector into what the server expects
		if (argument.selector == null) {
			argument.selector = [];
		} else if (typeof(argument.selector) === 'string') {
			argument.selector = argument.selector.trim();
			argument.selector = argument.selector.split('.');

			if (argument.selector[0] === '') {
				argument.selector = [];
			} else {
				for (let i = 0; i < argument.selector.length; i++) {
					if (!isNaN(argument.selector[i] as number)) { argument.selector[i] = +argument.selector[i]; }
				}
			}
		}
	}

	///------------------------------------------------------------------------------------------------------
	/// Cytoscape functions
	///------------------------------------------------------------------------------------------------------

	/**
	 * This function displays a form next to the graph for editing a node when clicked upon
	 * @param e JS Event fired
	 * @param self Reference to this PlaybookComponent
	 */
	onNodeSelect(e: any, self: PlaybookComponent): void {
		self.selectedNextStepParams = null;

		const data = e.target.data();

		self.selectedStep = self.loadedWorkflow.steps.find(s => s.uid === data.uid);

		if (!self.selectedStep) { return; }

		// Add data to the selectedStep if it does not exist
		if (!self.selectedStep.triggers) { self.selectedStep.triggers = []; }

		// TODO: maybe scope out relevant devices by action, but for now we're just only scoping out by app
		self.relevantDevices = self.devices.filter(d => d.app === data.app);
	}

	/**
	 * This function displays a form next to the graph for editing an edge when clicked upon.
	 * @param e JS Event fired
	 * @param self Reference to this PlaybookComponent
	 */
	onEdgeSelect(e: any, self: PlaybookComponent): void {
		self.selectedStep = null;
		self.selectedNextStepParams = null;

		const uid = e.target.data('uid');

		const nextStep = self.loadedWorkflow.next_steps.find(ns => ns.uid === uid);
		const sourceStep = self.loadedWorkflow.steps.find(s => s.uid === nextStep.source_uid);

		self.selectedNextStepParams = {
			nextStep,
			returnTypes: this._getAction(sourceStep.app, sourceStep.action).returns,
			app: sourceStep.app,
			action: sourceStep.action,
		};
	}

	/**
	 * This function unselects any selected nodes/edges and updates the label if necessary.
	 * @param e JS Event fired
	 * @param self Reference to this PlaybookComponent
	 */
	onUnselect(event: any, self: PlaybookComponent): void {
		// Update our labels if possible
		if (self.selectedStep) {
			this.cy.elements(`node[uid="${self.selectedStep.uid}"]`).data('label', self.selectedStep.name);
		}

		if (!self.cy.$(':selected').length) {
			self.selectedStep = null;
			self.selectedNextStepParams = null;
		}
	}

	/**
	 * This function checks when an edge is removed and removes next steps as appropriate.
	 * @param e JS Event fired
	 * @param self Reference to this PlaybookComponent
	 */
	onEdgeRemove(event: any, self: PlaybookComponent): void {
		const edgeData = event.target.data();
		// Do nothing if this is a temporary edge
		// (edgehandles do not have paramters, and we mark temp edges on edgehandle completion)
		if (!edgeData || edgeData.temp) { return; }

		const sourceUid = edgeData.source;
		const destinationUid = edgeData.target;

		// Filter out the one that matches
		this.loadedWorkflow.next_steps = this.loadedWorkflow.next_steps
			.filter(ns => !(ns.source_uid === sourceUid && ns.destination_uid === destinationUid));
	}

	/**
	 * This function checks when a node is added and sets start node if no other nodes exist.
	 * @param e JS Event fired
	 * @param self Reference to this PlaybookComponent
	 */
	onNodeAdded(event: any, self: PlaybookComponent): void {
		const node = event.target;

		// If the number of nodes in the graph is one, set the start node to it.
		if (node.isNode() && self.cy.nodes().size() === 1) { self.setStartNode(node.data('uid')); }
	}

	/**
	 * This function fires when a node is removed. If the node was the start node, it sets it to a new root node.
	 * It also removes the corresponding step from the workflow.
	 * @param e JS Event fired
	 * @param self Reference to this PlaybookComponent
	 */
	onNodeRemoved(event: any, self: PlaybookComponent): void {
		const node = event.target;
		const data = node.data();

		// If the start node was deleted, set it to one of the roots of the graph
		if (data && node.isNode() && self.loadedWorkflow.start === data.uid) { self.setStartNode(null); }
		if (self.selectedStep && self.selectedStep.uid === data.uid) { self.selectedStep = null; }

		// Delete the step from the workflow and delete any next steps that reference this step
		this.loadedWorkflow.steps = this.loadedWorkflow.steps.filter(s => s.uid !== data.uid);
		this.loadedWorkflow.next_steps = this.loadedWorkflow.next_steps
			.filter(ns => !(ns.source_uid === data.uid || ns.destination_uid === data.uid));
	}

	/**
	 * This function fires when an action is dropped onto the graph and fires the insertNode function.
	 * @param e JS Event fired
	 */
	handleDropEvent(e: any): void {
		if (this.cy === null) { return; }

		const appName: string = e.dragData.appName;
		const actionApi: ActionApi = e.dragData.actionApi;

		// The following coordinates is where the user dropped relative to the
		// top-left of the graph
		const dropPosition: GraphPosition = {
			x: e.mouseEvent.layerX,
			y: e.mouseEvent.layerY,
		};

		this.insertNode(appName, actionApi.name, dropPosition, true);
	}

	/**
	 * This function is fired when an action on the left-hand list is double clicked.
	 * It drops a new node of that action in the center of the visible graph.
	 * @param appName App name the action resides under
	 * @param actionName Name of the action that was double clicked
	 */
	handleDoubleClickEvent(appName: string, actionName: string): void {
		if (this.cy === null) { return; }

		const extent = this.cy.extent();

		function avg(a: number, b: number) { return (a + b) / 2; }

		const centerGraphPosition = { x: avg(extent.x1, extent.x2), y: avg(extent.y1, extent.y2) };
		this.insertNode(appName, actionName, centerGraphPosition, false);
	}

	/**
	 * Inserts node into the graph and adds a corresponding step to the loadedworkflow.
	 * @param appName App name the action resides under
	 * @param actionName Name of the action to add
	 * @param location Graph Position, where to create the node
	 * @param shouldUseRenderedPosition Whether or not to use rendered or "real" graph position
	 */
	insertNode(appName: string, actionName: string, location: GraphPosition, shouldUseRenderedPosition: boolean): void {
		// Grab a new uid for both the ID of the node and the ID of the step in the workflow
		// TODO: other aspects of the playbook editor use the uids generated in cytoscape
		// Should we change this logic to do a similar thing?
		const uid = UUID.UUID();

		const inputs: Argument[] = [];
		const parameters = this._getAction(appName, actionName).parameters;

		if (parameters && parameters.length) {
			this._getAction(appName, actionName).parameters.forEach((input) => {
				inputs.push({
					name: input.name,
					value: input.schema.default != null ? input.schema.default : null,
					reference: '',
					selector: '',
				});
			});
		}

		let stepToBeAdded: Step;
		let numExistingActions = 0;
		this.loadedWorkflow.steps.forEach(s => s.action === actionName ? numExistingActions++ : null);
		// Set our name to be something like "action 2" if "action" already exists
		const stepName = numExistingActions ? `${actionName} ${numExistingActions + 1}` : actionName;

		if (appName && actionName) { stepToBeAdded = new Step(); }
		stepToBeAdded.uid = uid;
		stepToBeAdded.name = stepName;
		stepToBeAdded.app = appName;
		stepToBeAdded.action = actionName;
		stepToBeAdded.inputs = inputs;

		this.loadedWorkflow.steps.push(stepToBeAdded);

		// Add the node with the uid just found to the graph in the location dropped
		// into by the mouse.
		const nodeToBeAdded = {
			group: 'nodes',
			data: {
				id: uid,
				uid,
				label: stepName,
				// parameters: {
				// 	action: action,
				// 	app: app,
				// 	device_id: 0,
				// 	errors: <any[]>[],
				// 	inputs: inputs,
				// 	uid: uid,
				// 	name: action,
				// 	next_steps: <any[]>[],
				// }
			},
			renderedPosition: null as GraphPosition,
			position: null as GraphPosition,
		};

		this._setNodeDisplayProperties(nodeToBeAdded, stepToBeAdded);

		if (shouldUseRenderedPosition) {
			nodeToBeAdded.renderedPosition = location;
		} else { nodeToBeAdded.position = location; }

		this.ur.do('add', nodeToBeAdded);
	}

	// TODO: update this to properly "cut" steps from the loadedWorkflow.
	/**
	 * Cytoscape cut method.
	 */
	cut(): void {
		const selecteds = this.cy.$(':selected');
		if (selecteds.length > 0) {
			this.cy.clipboard().copy(selecteds);
			this.ur.do('remove', selecteds);
		}
	}

	/**
	 * Cytoscape copy method.
	 */
	copy(): void {
		this.cy.clipboard().copy(this.cy.$(':selected'));
	}

	// TODO: update this to properly get new UIDs for pasted steps...
	/**
	 * Cytoscape paste method.
	 */
	paste(): void {
		const newNodes = this.ur.do('paste');

		newNodes.forEach((n: any) => {
			// Get a copy of the step we just copied
			const pastedStep: Step = _.clone(this.loadedWorkflow.steps.find(s => s.uid === n.data('uid')));

			// Note: we just grab the new uid from the pasted object.
			// Looks like the clipboard plugin uses the same sort of UUIDs we use...
			// Also delete the next field since user needs to explicitly
			// create new edges for the new node.
			const uid = n.data('id');

			pastedStep.uid = uid;

			n.data({
				uid,
				isStartNode: false,
			});

			this.loadedWorkflow.steps.push(pastedStep);
		});
	}

	/**
	 * Sets display properties for a given node based on the information on the related Step.
	 * @param stepNode Cytoscape node to update.
	 * @param step Step relating to the cytoscape node to update.
	 */
	_setNodeDisplayProperties(stepNode: any, step: Step): void {
		//add a type field to handle node styling
		if (this._getAction(step.app, step.action).event) {
			stepNode.type = 'eventAction';
		} else { stepNode.type = 'action'; }
	}

	/**
	 * Clears the red/green highlighting in the cytoscape graph.
	 */
	clearExecutionHighlighting(): void {
		this.cy.elements().removeClass('good-highlighted bad-highlighted');
	}

	/**
	 * Sets the start step / node to be the one matching the UID specified. Not specifying a UID just grabs the first root.
	 * @param start UID of the new start node (optional)
	 */
	setStartNode(start: string): void {
		// If no start was given set it to one of the root nodes
		if (start) {
			this.loadedWorkflow.start = start;
		} else {
			const roots = this.cy.nodes().roots();
			if (roots.size() > 0) {
				this.loadedWorkflow.start = roots[0].data('uid');
			}
		}

		// Clear start node highlighting of the previous start node(s)
		this.cy.elements('node[?isStartNode]').data('isStartNode', false);
		// Apply start node highlighting to the new start node.
		this.cy.elements(`node[uid="${start}"]`).data('isStartNode', true);
	}

	/**
	 * Removes all selected nodes and edges.
	 */
	removeSelectedNodes(): void {
		const selecteds = this.cy.$(':selected');
		if (selecteds.length > 0) { this.ur.do('remove', selecteds); }
	}

	/**
	 * Adds keyboard event bindings for cut/copy/paste/etc.
	 */
	_addCytoscapeEventBindings(): void {
		const self = this;

		// Handle keyboard presses on graph
		document.addEventListener('keydown', function (e) {
			if (self.cy === null) { return; }

			if (e.which === 46) { // Delete
				self.removeSelectedNodes();
			} else if (e.ctrlKey) {
				//TODO: re-enable undo/redo once we restructure how next steps / edges are stored
				// if (e.which === 90) // 'Ctrl+Z', Undo
				//     ur.undo();
				// else if (e.which === 89) // 'Ctrl+Y', Redo
				//     ur.redo();
				if (e.which === 67) {
					// Ctrl + C, Copy
					self.copy();
				} else if (e.which === 86) {
					// Ctrl + V, Paste
					self.paste();
				} else if (e.which === 88) {
					// Ctrl + X, Cut
					self.cut();
				}
				// else if (e.which == 65) { // 'Ctrl+A', Select All
				//     cy.elements().select();
				//     e.preventDefault();
				// }
			}
		});
	}

	///------------------------------------------------------------------------------------------------------
	/// Simple bootstrap modal stuff
	///------------------------------------------------------------------------------------------------------
	/**
	 * Opens a modal to rename a given playbook and performs the rename action on submit.
	 * @param playbook Name of the playbook to rename
	 */
	renamePlaybookModal(playbook: string): void {
		this._closeWorkflowsModal();

		this.modalParams = {
			title: 'Rename Existing Playbook',
			submitText: 'Rename Playbook',
			shouldShowPlaybook: true,
			submit: () => {
				this.playbookService.renamePlaybook(playbook, this.modalParams.newPlaybook)
					.then(() => {
						this.playbooks.find(pb => pb.name === playbook).name = this.modalParams.newPlaybook;
						this.toastyService.success(`Successfully renamed playbook "${this.modalParams.newPlaybook}".`);
						this._closeModal();
					})
					.catch(e => this.toastyService.error(`Error renaming playbook "${this.modalParams.newPlaybook}": ${e.message}`));
			},
		};

		this._openModal();
	}

	/**
	 * Opens a modal to copy a given playbook and performs the copy action on submit.
	 * @param playbook Name of the playbook to copy
	 */
	duplicatePlaybookModal(playbook: string): void {
		this._closeWorkflowsModal();

		this.modalParams = {
			title: 'Duplicate Existing Playbook',
			submitText: 'Duplicate Playbook',
			shouldShowPlaybook: true,
			submit: () => {
				this.playbookService.duplicatePlaybook(playbook, this.modalParams.newPlaybook)
					.then(() => {
						const duplicatedPb: Playbook = _.cloneDeep(this.playbooks.find(pb => pb.name === playbook));
						duplicatedPb.name = this.modalParams.newPlaybook;
						this.playbooks.push(duplicatedPb);
						this.playbooks.sort((a, b) => a.name > b.name ? 1 : -1);
						this.toastyService
							.success(`Successfully duplicated playbook "${playbook}" as "${this.modalParams.newPlaybook}".`);
						this._closeModal();
					})
					.catch(e => this.toastyService
						.error(`Error duplicating playbook "${this.modalParams.newPlaybook}": ${e.message}`));
			},
		};

		this._openModal();
	}

	/**
	 * Opens a modal to delete a given playbook and performs the delete action on submit.
	 * @param playbook Name of the playbook to delete
	 */
	deletePlaybook(playbook: string): void {
		if (!confirm(`Are you sure you want to delete playbook "${playbook}"?`)) { return; }

		this.playbookService
			.deletePlaybook(playbook)
			.then(() => {
				this.playbooks = this.playbooks.filter(p => p.name !== playbook);

				// If our loaded workflow is in this playbook, close it.
				if (playbook === this.currentPlaybook) { this.closeWorkflow(); }
				
				this.toastyService.success(`Successfully deleted playbook "${playbook}".`);
			})
			.catch(e => this.toastyService
				.error(`Error deleting playbook "${playbook}": ${e.message}`));
	}

	/**
	 * Opens a modal to add a new workflow to a given playbook or under a new playbook.
	 */
	newWorkflowModal(): void {
		this._closeWorkflowsModal();

		this.modalParams = {
			title: 'Create New Workflow',
			submitText: 'Add Workflow',
			shouldShowExistingPlaybooks: true,
			shouldShowPlaybook: true,
			shouldShowWorkflow: true,
			submit: () => {
				const playbookName = this._getModalPlaybookName();
				this.playbookService.newWorkflow(playbookName, this.modalParams.newWorkflow)
					.then(newWorkflow => {
						const pb = this.playbooks.find(p => p.name === playbookName);
						if (pb) {
							pb.workflows.push(newWorkflow);
							pb.workflows.sort((a, b) => a.name > b.name ? 1 : -1);
						} else {
							this.playbooks.push({ name: playbookName, workflows: [newWorkflow], uid: null });
							this.playbooks.sort((a, b) => a.name > b.name ? 1 : -1);
						}
						if (!this.loadedWorkflow) { this.loadWorkflow(playbookName, this.modalParams.newWorkflow); }
						this.toastyService.success(`Created workflow "${playbookName} - ${this.modalParams.newWorkflow}".`);
						this._closeModal();
					})
					.catch(e => this.toastyService
						.error(`Error creating workflow "${playbookName} - ${this.modalParams.newWorkflow}": ${e.message}`));
			},
		};

		this._openModal();
	}

	/**
	 * Opens a modal to delete a given workflow and performs the rename action on submit.
	 * @param playbook Name of the playbook the workflow resides under
	 * @param workflow Name of the workflow to rename
	 */
	renameWorkflowModal(playbook: string, workflow: string): void {
		this._closeWorkflowsModal();

		this.modalParams = {
			title: 'Rename Existing Workflow',
			submitText: 'Rename Workflow',
			shouldShowWorkflow: true,
			submit: () => {
				const playbookName = this._getModalPlaybookName();
				this.playbookService.renameWorkflow(playbook, workflow, this.modalParams.newWorkflow)
					.then(() => {
						this.playbooks
							.find(pb => pb.name === playbook).workflows
							.find(wf => wf.name === workflow).name = this.modalParams.newWorkflow;

						// Rename our loaded workflow if necessary.
						if (this.currentPlaybook === playbook && this.currentWorkflow === workflow && this.loadedWorkflow) {
							this.loadedWorkflow.name = this.modalParams.newWorkflow;
							this.currentWorkflow = this.modalParams.newWorkflow;
						}
						this.toastyService.success(`Successfully renamed workflow "${playbookName} - ${this.modalParams.newWorkflow}".`);
						this._closeModal();
					})
					.catch(e => this.toastyService
						.error(`Error renaming workflow "${playbookName} - ${this.modalParams.newWorkflow}": ${e.message}`));
			},
		};

		this._openModal();
	}

	/**
	 * Opens a modal to copy a given workflow and performs the copy action on submit.
	 * @param playbook Name of the playbook the workflow resides under
	 * @param workflow Name of the workflow to copy
	 */
	duplicateWorkflowModal(playbook: string, workflow: string): void {
		this._closeWorkflowsModal();

		this.modalParams = {
			title: 'Duplicate Existing Workflow',
			submitText: 'Duplicate Workflow',
			// shouldShowPlaybook: true,
			// shouldShowExistingPlaybooks: true,
			selectedPlaybook: playbook,
			shouldShowWorkflow: true,
			submit: () => {
				const playbookName = this._getModalPlaybookName();
				this.playbookService.duplicateWorkflow(playbook, workflow, this.modalParams.newWorkflow)
					.then(duplicatedWorkflow => {
						let pb = this.playbooks.find(p => p.name === playbook);

						if (!pb) {
							pb = { uid: null, name: this._getModalPlaybookName(), workflows: [] };
							this.playbooks.push(pb);
							this.playbooks.sort((a, b) => a.name > b.name ? 1 : -1);
						}

						pb.workflows.push(duplicatedWorkflow);
						pb.workflows.sort((a, b) => a.name > b.name ? 1 : -1);

						this.toastyService
							.success(`Successfully duplicated workflow "${playbookName} - ${this.modalParams.newWorkflow}".`);
						this._closeModal();
					})
					.catch(e => this.toastyService
						.error(`Error duplicating workflow "${playbookName} - ${this.modalParams.newWorkflow}": ${e.message}`));
			},
		};

		this._openModal();
	}

	/**
	 * Opens a modal to delete a given workflow and performs the delete action on submit.
	 * @param playbook Name of the playbook the workflow resides under
	 * @param workflow Name of the workflow to delete
	 */
	deleteWorkflow(playbook: string, workflow: string): void {
		if (!confirm(`Are you sure you want to delete workflow "${playbook} - ${workflow}"?`)) { return; }

		this.playbookService
			.deleteWorkflow(playbook, workflow)
			.then(() => {
				const pb = this.playbooks.find(p => p.name === playbook);
				pb.workflows = pb.workflows.filter(w => w.name !== workflow);

				if (!pb.workflows.length) { this.playbooks = this.playbooks.filter(p => p.name !== pb.name); }

				// Close the workflow if the deleted workflow matches the loaded one
				if (playbook === this.currentPlaybook && workflow === this.currentWorkflow) { this.closeWorkflow(); }
				
				this.toastyService.success(`Successfully deleted workflow "${playbook} - ${workflow}".`);
			})
			.catch(e => this.toastyService.error(`Error deleting workflow "${playbook} - ${workflow}": ${e.message}`));
	}

	/**
	 * Function to open the bootstrap playbook/workflow action modal.
	 */
	_openModal(): void {
		($('#playbookAndWorkflowActionModal') as any).modal('show');
	}

	/**
	 * Function to close the bootstrap playbook/workflow action modal.
	 */
	_closeModal(): void {
		($('#playbookAndWorkflowActionModal') as any).modal('hide');
	}

	/**
	 * Function to close the bootstrap load workflow modal.
	 */
	_closeWorkflowsModal(): void {
		($('#workflowsModal') as any).modal('hide');
	}
	
	/**
	 * Gets the playbook name from a given modal:
	 * either by the selected playbook or whatever's specified under new playbook.
	 */
	_getModalPlaybookName(): string {
		if (this.modalParams.selectedPlaybook && this.modalParams.selectedPlaybook !== '') {
			return this.modalParams.selectedPlaybook;
		}

		return this.modalParams.newPlaybook;
	}

	///------------------------------------------------------------------------------------------------------
	/// Utility functions
	///------------------------------------------------------------------------------------------------------
	/**
	 * Gets a list of playbook names from our list of playbooks.
	 */
	getPlaybooks(): string[] {
		return this.playbooks.map(pb => pb.name);
	}

	/**
	 * Checks if a workflow exists by playbook and workflow name.
	 * @param playbook Playbook to check
	 * @param workflow Workflow to check
	 */
	_doesWorkflowExist(playbook: string, workflow: string): boolean {
		const matchingPB = this.playbooks.find(pb => pb.name === playbook);

		if (!matchingPB) { return false; }

		return matchingPB.workflows.findIndex(wf => wf.name === workflow ) >= 0;
	}

	// TODO: maybe somehow recursively find steps that may occur before. Right now it just returns all of them.
	/**
	 * Gets a list of steps previous to the currently selected step. (Currently just grabs a list of all steps.)
	 */
	getPreviousSteps(): Step[] {
		return this.loadedWorkflow.steps;
	}

	/**
	 * Gets an ActionApi object by app and action name
	 * @param appName App name the action resides under
	 * @param actionName Name of the ActionApi to query
	 */
	_getAction(appName: string, actionName: string): ActionApi {
		return this.appApis.find(a => a.name === appName).action_apis.find(a => a.name === actionName);
	}

	/**
	 * Gets a list of ConditionApis from a given app name.
	 * @param appName App name to query
	 */
	getConditionApis(appName: string): ConditionApi[] {
		return this.appApis.find(a => a.name === appName).condition_apis;
	}

	/**
	 * Gets a list of TransformApis from a given app name.
	 * @param appName App name to query
	 */
	getTransformApis(appName: string): TransformApi[] {
		return this.appApis.find(a => a.name === appName).transform_apis;
	}

	/**
	 * Gets a list of TransformApis from a given app name.
	 * @param appName App name to query
	 */
	getDeviceApis(appName: string): DeviceApi[] {
		return this.appApis.find(a => a.name === appName).device_apis;
	}

	/**
	 * Gets an parameterApi matching the app, action, and input names specified.
	 * @param appName App name the ActionApi resides under
	 * @param actionName Name of the ActionApi to query
	 * @param inputName Name of the action input to query
	 */
	getInputApiArgs(appName: string, actionName: string, inputName: string): ParameterApi {
		return this._getAction(appName, actionName).parameters.find(a => a.name === inputName);
	}

	/**
	 * Filters only the apps that have actions specified
	 */
	getAppsWithActions(): AppApi[] {
		return this.appApis.filter(a => a.action_apis && a.action_apis.length);
	}
}
